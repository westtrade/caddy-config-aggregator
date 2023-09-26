const path = require("node:path");
const { glob } = require("glob");
const throttle = require("lodash.throttle");
const { logger } = require("./logger");
const fs = require("node:fs/promises");
const dotenv = require("dotenv");
const process = require("process");
const { exec } = require("node:child_process");
const watcher = require("@parcel/watcher");
const { makeFsStructure } = require("./blueprintFS");

const callbackExecutor = (callback) =>
	throttle(async () => {
		if (callback) {
			exec(
				callback,
				{
					cwd: process.cwd(),
				},
				(err, stdout, stderr) => {
					if (err) {
						logger.error(err);
					} else {
						logger.info("Command result: ", { stdout, stderr });
					}
				}
			);
		}
	}, 500);

const localToCommonVariableNameReducer = (result, [key, value]) => {
	const perfixedKey = `${result.envPrefix}_${key}`.replace(/ /, "_");
	result.variables[perfixedKey] = value;
	result.replaces[key] = perfixedKey;

	return result;
};

let prevConfigCount = -1;

const configWatcher = (rootPath, resultPath, onChange) => {
	let initialResolve;
	const watcherController = {
		configFS: {},
		rootWatcher: undefined,
		status: new Promise((resolve) => (initialResolve = resolve)),
	};

	const searchAndAggregateConfig = throttle(async () => {
		try {
			const configurationFiles = await glob([
				path.resolve(rootPath, "./**/current/docker/caddy/Caddyfile"),
			]);

			if (prevConfigCount === 0 && configurationFiles.length === 0) {
				return;
			}

			prevConfigCount = configurationFiles.length;

			const newConfigFSStructure = await configurationFiles.reduce(
				async (resultPromise, caddyFilePath) => {
					const configFS = await resultPromise;

					const rootPath = caddyFilePath.split("current").at(0);

					const envFilePath = path.resolve(rootPath, "current/.env");
					let envFileAccess = false;

					try {
						await fs.access(envFilePath, fs.constants.R_OK);
						envFileAccess = true;
					} catch (error) {
						envFileAccess = false;
						logger.error(error);
					}

					const websiteBase = path.basename(rootPath);
					const caddyFileContent = await fs.readFile(caddyFilePath, "utf-8");

					configFS[".env"] = configFS[".env"] || {
						"#type": "file",
						"#content": "",
					};

					configFS[websiteBase] = {
						Caddyfile: {
							"#type": "file",
							"#content": caddyFileContent,
						},
					};

					if (envFileAccess) {
						const envFileContent = await fs.readFile(envFilePath, "utf-8");
						const envPrefix = websiteBase.toUpperCase().replace(/[\.-]/, "_");
						const websiteEnvironment = dotenv.parse(envFileContent);

						const caddyEnvironment = Object.entries(websiteEnvironment).reduce(
							localToCommonVariableNameReducer,
							{
								replaces: {},
								variables: {},
								envPrefix,
							}
						);

						configFS[websiteBase].Caddyfile["#content"] = Object.entries(
							caddyEnvironment.replaces
						).reduce(
							(result, [key, replaceTo]) => result.replaceAll(key, replaceTo),
							caddyFileContent
						);

						const resultEnvFilecontent = Object.entries(
							caddyEnvironment.variables
						).reduce(
							(result, [key, value]) => `${result}\n${key}=${value}`,
							`# ------------------------- ${envPrefix} -------------------------
# file: ${envFilePath}`
						);

						configFS[".env"][
							"#content"
						] = `${configFS[".env"]["#content"]}\n${resultEnvFilecontent}\n\n`;
					}

					return configFS;
				},
				Promise.resolve({
					"#clear": true,
				})
			);

			const result = await makeFsStructure(resultPath, newConfigFSStructure);
			logger.info(
				`update: [${result
					.map((sitePath) =>
						sitePath.replace(resultPath, "").replace(/^\//, "")
					)
					.join(", ")}]`
			);
		} catch (error) {
			logger.error(error);
		}

		if (onChange) {
			await onChange();
		}
	}, 500);

	searchAndAggregateConfig();

	watcherController.start = async () => {
		watcherController.rootWatcher = await watcher.subscribe(
			rootPath,
			searchAndAggregateConfig,
			{
				ignore: [
					"node_modules",
					"logs",
					"*log",
					".cache",
					".parcel-cache",
					"dist",
					"public",
					".yarn",
					"test-data",
				],
			}
		);

		if (initialResolve) {
			initialResolve(true);
			initialResolve = null;
		}
	};

	watcherController.start();

	watcherController.close = async () => {
		const { rootWatcher } = watcherController;
		if (rootWatcher) {
			await rootWatcher.unsubscribe();
			watcherController.rootWatcher = undefined;
		}
	};

	return watcherController;
};

module.exports = {
	configWatcher,
	callbackExecutor,
};

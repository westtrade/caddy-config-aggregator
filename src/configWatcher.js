const chokidar = require("chokidar");
const path = require("node:path");
const { glob } = require("glob");
const throttle = require("lodash.throttle");
const debounceCollect = require("debounce-collect");
const { logger } = require("./logger");
const fs = require("node:fs/promises");
const dotenv = require("dotenv");
const rimraf = require("rimraf");
const process = require("process");
const { exec } = require("node:child_process");

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

const configWatcher = (rootPath, resultPath, onChange) => {
	const watcher = {
		allFiles: {},
		filesWatcher: undefined,
		rootWatcher: undefined,
	};

	const filesChangesHandler = debounceCollect(async (events) => {
		try {
			logger.info(
				"Files: " +
					events
						.map(([eventType, filePath]) => {
							return `${eventType}: ${filePath};`;
						})
						.join("\n")
			);

			watcher.allFiles = events.reduce((result, [eventType, filePath]) => {
				const [fileRoot, fileRelativePath] = filePath.split("current");
				const fileBase = path.basename(fileRelativePath);

				return {
					...result,
					[fileRoot]: {
						...(result[fileRoot] || {}),
						[fileBase]: [eventType, filePath],
					},
				};
			}, watcher.allFiles);

			const currentConfigs = Object.entries(watcher.allFiles).reduce(
				(
					result,
					[root, { [".env"]: envFile, ["Caddyfile"]: caddyfile } = {}]
				) => {
					const status =
						envFile[0] === "unlink" || caddyfile[0] === "unlink"
							? "unlink"
							: "exists";

					return [...result, [root, status, envFile[1], caddyfile[1]]];
				},
				[]
			);
			let environment = {};

			await Promise.all(
				currentConfigs.map(
					async ([root, status, envFilePath, caddyFilePath]) => {
						const websiteBase = path.basename(root);
						const configPath = path.resolve(resultPath, websiteBase);
						const caddyFileOutPath = path.resolve(configPath, "Caddyfile");

						if (status === "exists") {
							await fs.mkdir(configPath, { recursive: true });
							let caddyConfigContent = await fs.readFile(
								caddyFilePath,
								"utf-8"
							);
							const envFileContent = await fs.readFile(envFilePath, "utf-8");
							const environmentPrefix = websiteBase
								.toUpperCase()
								.replace(/[\.-]/, "_");

							const localEnvironment = Object.entries(
								dotenv.parse(envFileContent)
							).reduce(
								(result, [key, value]) => {
									const perfixedKey = `${environmentPrefix}_${key}`;
									result.variables[perfixedKey] = value;
									result.replaces[key] = perfixedKey;
									return result;
								},
								{
									variables: {},
									replaces: {},
								}
							);

							caddyConfigContent = Object.entries(
								localEnvironment.replaces
							).reduce(
								(result, [key, replaceTo]) => result.replaceAll(key, replaceTo),
								caddyConfigContent
							);

							environment = {
								...environment,
								[`---${environmentPrefix}---`]: [
									environmentPrefix,
									envFilePath,
								],
								...localEnvironment.variables,
							};

							await fs.writeFile(caddyFileOutPath, caddyConfigContent, "utf-8");
						} else {
							await rimraf(configPath);
						}
					}
				)
			);

			const envFileContent = Object.entries(environment).reduce(
				(result, [key, value]) => {
					if (key.startsWith("---")) {
						const [envPrefix, envPath] = value;
						result = `${result}\n\n# ------------------------- ${envPrefix} -------------------------`;
						result = `${result}\n# file: ${envPath}\n`;
					} else {
						result = `${result}\n${key}=${value}`;
					}

					return result;
				},
				""
			);

			await fs.writeFile(
				path.resolve(resultPath, ".env"),
				envFileContent,
				"utf-8"
			);

			if (onChange) {
				await onChange();
			}
		} catch (error) {
			logger.error(error);
		}
	}, 100);

	const rootWatcherFiles = [path.resolve(rootPath, "./**/current")];
	watcher.rootWatcher = chokidar.watch(rootWatcherFiles, {
		persistent: true,
		ignoreInitial: false,
		followSymlinks: true,
		depth: 1,
		ignore: "node_modules/**",
	});

	const startRootWatching = throttle(async () => {
		const watchFiles = await glob([
			path.resolve(rootPath, "./**/current"),
			path.resolve(rootPath, "./**/current/docker/caddy/Caddyfile"),
			path.resolve(rootPath, "./**/current/.env"),
		]);

		if (watcher.filesWatcher) {
			watcher.filesWatcher.close();
			watcher.filesWatcher = undefined;
		}

		watcher.filesWatcher = chokidar.watch(watchFiles, {
			persistent: true,
			depth: 2,
			ignore: "node_modules/**",
		});

		watcher.filesWatcher.on("all", filesChangesHandler);
	}, 300);

	watcher.rootWatcher.on("all", startRootWatching);

	watcher.close = function () {
		startRootWatching.cancel();
		if (this.rootWatcher) {
			this.rootWatcher.close();
			this.rootWatcher = undefined;
		}

		if (this.fileWatcher) {
			this.filesWatcher.close();
			this.filesWatcher = undefined;
		}
	}.bind(watcher);

	return watcher;
};

module.exports = {
	configWatcher,
	callbackExecutor,
};

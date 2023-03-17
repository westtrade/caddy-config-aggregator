const { version } = require("../package.json");
const { logger, setLogLevel } = require("./logger");
const { exec } = require("node:child_process");
const chokidar = require("chokidar");
const path = require("node:path");
const { glob } = require("glob");
const debounceCollect = require("debounce-collect");
const fs = require("node:fs/promises");
const dotenv = require("dotenv");
const util = require("util");
const ensureFS = require("ensure-fs");
const { promisify } = require("node:util");
const { default: rimraf } = require("rimraf");
const throttle = require("lodash.throttle");
const { readFile } = require("node:fs/promises");
const { program } = require("commander");
const process = require("process");

const watchCaristoConfigs = async (rootPath, resultPath, onChange) => {
	let allFiles = {};
	let filesListener = undefined;

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

			allFiles = events.reduce((result, [eventType, filePath]) => {
				const [fileRoot, fileRelativePath] = filePath.split("current");
				const fileBase = path.basename(fileRelativePath);

				return {
					...result,
					[fileRoot]: {
						...(result[fileRoot] || {}),
						[fileBase]: [eventType, filePath],
					},
				};
			}, allFiles);

			const currentConfigs = Object.entries(allFiles).reduce(
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
							let caddyConfigContent = await readFile(caddyFilePath, "utf-8");
							const envFileContent = await readFile(envFilePath, "utf-8");
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
						result = `${result}\n# file: ${envPath}\n\n`;
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
	const rootDirectoryWatcher = chokidar.watch(rootWatcherFiles, {
		persistent: true,
		ignoreInitial: false,
		followSymlinks: true,
		depth: 1,
		ignore: "node_modules/**",
	});

	rootDirectoryWatcher.on(
		"all",
		throttle(async () => {
			const watchFiles = await glob([
				path.resolve(rootPath, "./**/current/docker/caddy/Caddyfile"),
				path.resolve(rootPath, "./**/current/.env"),
			]);

			if (filesListener) {
				filesListener.close();
				filesListener = undefined;
			}

			filesListener = chokidar.watch(watchFiles, {
				persistent: true,
				ignore: "node_modules/**",
			});

			filesListener.on("all", filesChangesHandler);
		}, 300)
	);
};

program
	.version(version)
	.description("Caristo - config watcher for Caddy server")
	.argument("[input]", "Caristo websites path")
	.argument("[output]", "Caddy output folder")
	.option(
		`-i, --input, <char> Caristo websites path (default: ${process.cwd()}/data)`
	)
	.option(
		`-o, --output, <char> Caddy output folder (default: ${process.cwd()}/out)`
	)
	.option(`-c, --callback, <char> Callback (default: None)`)
	.option(`-l, --level, <char> Logger level (default: )`)
	.action(async (input, output, options) => {
		const websitesPath = path.resolve(
			process.cwd(),
			input || options.input || process.cwd()
		);
		const configPath = path.resolve(
			process.cwd(),
			output || options.output || process.cwd()
		);

		setLogLevel(options.level || "");

		logger.info("Starts with config:", {
			input: websitesPath,
			output: configPath,
			callback: options.callback,
		});

		try {
			await watchCaristoConfigs(websitesPath, configPath, async () => {
				if (options.callback) {
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
			});
		} catch (error) {
			logger.error(error);
		}
	})
	.parse();

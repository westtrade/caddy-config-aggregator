const { version } = require("../package.json");
const { logger, setLogLevel } = require("./logger");
const { exec } = require("node:child_process");
const path = require("node:path");
const { program } = require("commander");
const process = require("process");
const configWatcher = require("./configWatcher");

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
			await configWatcher(websitesPath, configPath, async () => {
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

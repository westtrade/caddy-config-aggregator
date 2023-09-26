const { version } = require("../package.json");
const { logger, setLogLevel } = require("./logger");
const path = require("node:path");
const { program } = require("commander");
const process = require("process");
const { configWatcher, callbackExecutor } = require("./configWatcher");

program
	.version(version)
	.description("Caristo - config watcher for Caddy server")
	.argument("[input]", "Caristo websites path")
	.argument("[output]", "Caddy output folder")
	.option(
		`-i, --input, <char> Caristo websites path (default: ${path.resolve(
			process.cwd(),
			"data"
		)})`
	)
	.option(
		`-o, --output, <char> Caddy output folder (default:  ${path.resolve(
			process.cwd(),
			"out"
		)})`
	)
	.option(`-c, --callback, <char> Callback (default: None)`)
	.option(`-l, --level, <char> Logger level (default: "")`)
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
			await configWatcher(
				websitesPath,
				configPath,
				callbackExecutor(options.callback)
			);
		} catch (error) {
			logger.error(error);
		}
	})
	.parse();

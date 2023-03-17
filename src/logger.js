const { createLogger, format, transports, config } = require("winston");

let logger = createLogger({
	format: format.combine(
		format.colorize(),
		format.timestamp({
			format: "YYYY-MM-DD HH:mm:ss",
		}),
		format.splat(),
		format.simple()
	),
});

let consoleTransport;
function setLogLevel(logLevel) {
	if (consoleTransport) {
		logger.remove(consoleTransport);
	}
	consoleTransport = new transports.Console({
		timestamp: true,
		level: logLevel,
	});

	logger.add(consoleTransport);
}

setLogLevel("info");

module.exports = { setLogLevel, logger };

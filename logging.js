const config = require('config').get('pg');

const format = [
	'{{timestamp}} <{{title}}> {{message}}', // default format
	{
		error: '{{timestamp}} <{{title}}> {{message}}\nCall Stack:\n{{stack}}', // error format
	},
];
const fileLogger = require('tracer').dailyfile({
	root: config.logDir,
	format,
	maxLogFiles: 10,
	allLogsFileName: 'postgres_backup',
});
const consoleLogger = require('tracer').colorConsole({format});

let consoleOn = false;

function enableConsole(enConsole) {
	if (enConsole) {
		consoleOn = true;
		consoleLogger.log('Console logging enabled!');
	}
	else {
		consoleOn = false;
	}
}

const logger = {
	log(...args) {
		fileLogger.log(...args);
		if (consoleOn) {
			consoleLogger.log(...args);
		}
	},
	trace(...args) {
		fileLogger.trace(...args);
		if (consoleOn) {
			consoleLogger.trace(...args);
		}
	},
	debug(...args) {
		fileLogger.debug(...args);
		if (consoleOn) {
			consoleLogger.debug(...args);
		}
	},
	info(...args) {
		fileLogger.info(...args);
		if (consoleOn) {
			consoleLogger.info(...args);
		}
	},
	warn(...args) {
		fileLogger.warn(...args);
		if (consoleOn) {
			consoleLogger.warn(...args);
		}
	},
	error(...args) {
		fileLogger.error(...args);
		consoleLogger.error(...args);
	},
	console(...args) {
		fileLogger.trace(...args);
		consoleLogger.log(...args);
	},
	enableConsole,
};

module.exports = logger;

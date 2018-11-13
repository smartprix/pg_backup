const os = require('os');
const {Oak, FileLogs, ConsoleLogs} = require('@smpx/oak');
const {cfg} = require('sm-utils');

const {version} = require('../package.json');

const fileLogger = new FileLogs({path: cfg('pg.logDir'), table: 'log'});
const consoleLogger = new ConsoleLogs();

let consoleStatus = false;

class Logger extends Oak {
	static enableConsole(enable = true) {
		if (cfg.isDev()) {
			return;
		}
		if (enable && !consoleStatus) {
			Logger.setTransports([consoleLogger, fileLogger]);
			consoleStatus = true;
			Logger.info('Console logging enabled!');
		}
		else if (consoleStatus) {
			Logger.info('Console logging disabling');
			Logger.setTransports(fileLogger);
			consoleStatus = false;
		}
	}

	static console(...args) {
		this.default.console(...args);
	}

	console(...args) {
		const originalStatus = consoleStatus;
		Logger.enableConsole();
		this.info(...args);
		Logger.enableConsole(originalStatus);
	}
}

Logger.setGlobalOptions({
	hostname: os.hostname(),
	app: 'pg_backup',
	version,
	env: {NODE_ENV: process.env.NODE_ENV},
	appName: 'pg_backup',
	level: 'silly', // default level
	table: 'log',
});

if (cfg.isDev()) {
	Logger.enableConsole();
}

module.exports = Logger;

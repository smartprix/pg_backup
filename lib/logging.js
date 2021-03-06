const os = require('os');
const {Oak, FileLogs, ConsoleLogs} = require('@smpx/oak');
const {cfg} = require('sm-utils');

const {version} = require('../package.json');

const fileLogger = new FileLogs({path: cfg('pg.logDir'), table: 'log', level: 'silly', filter: false});
// @ts-ignore
const consoleLogger = new ConsoleLogs();

let consoleStatus = false;

class Logger extends Oak {
	static enableConsole(enable = true, log = true) {
		if (enable && !consoleStatus) {
			this.setTransports([consoleLogger, fileLogger]);
			consoleStatus = true;
			if (log) this.info('Console logging enabled!');
		}
		else if (!enable && consoleStatus) {
			if (log) this.info('Disabling console logging');
			this.setTransports(fileLogger);
			consoleStatus = false;
		}
	}

	static console(...args) {
		// @ts-ignore
		this.default.console(...args);
	}

	console(...args) {
		if (typeof args[0] === 'object') {
			args[0].label = 'console';
		}
		else {
			args = [{label: 'console'}, ...args];
		}

		const originalStatus = consoleStatus;
		Logger.enableConsole(true, false);
		this.info(...args);
		Logger.enableConsole(originalStatus, false);
	}

	// eslint-disable-next-line class-methods-use-this
	enableConsole(enable = true, log = true) {
		Logger.enableConsole(enable, log);
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

Logger.setTransports(fileLogger);

if (cfg.isDev()) {
	Logger.enableConsole(true, false);
}

module.exports = Logger;

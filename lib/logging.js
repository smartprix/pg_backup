const {Oak, FileLogs, ConsoleLogs} = require('@smpx/oak');
const {cfg} = require('sm-utils');

const fileLogger = new FileLogs({path: cfg('pg.logDir'), table: 'pg_backup'});
const consoleLogger = new ConsoleLogs();

let consoleStatus = false;

function enableConsole(enable = true) {
	if (enable && !consoleStatus) {
		Oak.setTransports([consoleLogger, fileLogger]);
		consoleStatus = true;
		Oak.info('Console logging enabled!');
	}
	else if (consoleStatus) {
		Oak.info('Console logging disabling');
		Oak.setTransports(fileLogger);
		consoleStatus = false;
	}
}

Oak.enableConsole = enableConsole;
Oak.console = function (...args) {
	const originalStatus = consoleStatus;
	enableConsole();
	Oak.info(...args);
	enableConsole(originalStatus);
};

module.exports = Oak;

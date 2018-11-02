const moment = require('moment');
const config = require('config');
const commandLineCommands = require('command-line-commands');
const commandLineArgs = require('command-line-args');
const getUsage = require('command-line-usage');

const logger = require('./logging');
const backup = require('./wal-e_backup');
const restore = require('./wal-e_restore');
const sendSlack = require('./slack');
const gcs = require('./gcs');

const cron = config.get('pg').cron;
const waleHost = config.get('wale').host;
const dateFormat = ['YYYY-MM-DD', 'YYYY-MM-DD_HH', 'YYYY-MM-DD_HH-mm', 'YYYY-MM-DD_HH-mm-ss'];

const validCommands = [null, 'help', '-h', 'list', 'backup', 'restore', 'restore-date', 'delete', 'cron', 'size', 'copy'];
const {command, argv} = commandLineCommands(validCommands);

function parseDate(d) {
	const momentx = moment(d, dateFormat);
	return momentx.isValid() ? momentx : moment();
}

const optionDefinitions = [
	{
		name: 'log',
		alias: 'l',
		type: Boolean,
		description: 'Enables console logging when this option is used, by default only file logging is enabled',
	}, {
		name: 'detail',
		type: Boolean,
		description: 'Get a more detailed list of backups, which also lists the required wal files(start-end) for each backup',
		group: ['list'],
	}, {
		name: 'branch',
		alias: 'b',
		type: String,
		defaultValue: 'daily',
		description: 'Specify the branch on which to perform the operation (default: daily)',
		group: ['list', 'restore', 'delete', 'copy'],
	}, {
		name: 'host',
		alias: 'h',
		type: String,
		defaultValue: waleHost,
		description: 'Specify the host whose backups are to be queried (default: ' + waleHost + ')',
		group: ['list', 'restore', 'size', 'restoreDate'],
	}, {
		name: 'retain',
		alias: 'r',
		type: Number,
		defaultValue: '12',
		description: 'Specify the number of latest backups to retain and delete the rest (default: 12)',
		group: ['delete'],
	}, {
		name: 'force',
		alias: 'f',
		type: Boolean,
		description: 'Enables force restore if enabled, will rename any existing PGDATA directory.',
		group: ['restore'],
	}, {
		name: 'base',
		type: String,
		defaultValue: 'LATEST',
		description: 'Specify the base backup to restore from (default: LATEST)',
		group: ['restore'],
	}, {
		name: 'date',
		alias: 'd',
		type: parseDate,
		defaultValue: moment(),
		description: 'Specify the date to which restore is to be done (default: NOW) (FORMAT: YYYY-MM-DD_HH-mm-ss, HH,mm,ss are optional)',
		group: ['restoreDate', 'restore'],
	}, {
		name: 'day',
		alias: 'w',
		type: String,
		defaultValue: '6',
		description: 'Specify the weekday for which the daily backup will be copied to specified branch (default: 6) (FORMAT: ...-1: Last Sat, 0: Sun, 1: Mon...)',
		group: ['copy'],
	},
];

const sections = [
	{
		header: 'Postgres Backup',
		content: 'A node utility to manage PstgreSQL backups on Google Cloud Storage. It uses wal-e (http://github.com/wal-e/wal-e) to peform restores, backups, and cleanups.',
	},
	{
		header: 'Synopsis',
		content: '$ postgres_backup <command> <options>',
	},
	{
		header: 'Command List',
		content: [
			{
				name: 'help',
				summary: 'Display help information about postgres_backup.',
			},
			{
				name: 'backup',
				summary: 'Perform a base backup of PostgreSQL Database to daily branch',
			},
			{
				name: 'list [--branch BRANCH --host HOST --detail]',
				summary: 'List all the existing base backups in specified branch',
			},
			{
				name: 'delete [--branch BRANCH --retain N]',
				summary: 'Deletes older backups while retaining the latest N backups',
			},
			{
				name: 'restore [--branch BRANCH --base BACKUP_NAME --date DATE --force BOOL --host HOST]',
				summary: 'Restore a backup with the specified params',
			}, {
				name: 'restore-date [--date DATE --host HOST]',
				summary: 'Restore from automatically selected latest backup before the specified date',
			},
			{
				name: 'size [--host HOST]',
				summary: 'Get the total size of all the backups for the specified host',
			},
			{
				name: 'copy [--day WEEKDAY --branch DEST_BRANCH]',
				summary: 'Copies a daily backup done on the specified WEEKDAY to the specified branch',
			},
			{
				name: 'cron',
				summary: 'Perform daily and weekly branch backup and deletion and send slack report',
			},
		],
	},
	{
		header: 'Options List',
		optionList: optionDefinitions,
	},
];
const usage = getUsage(sections);
let options = commandLineArgs(optionDefinitions, {argv});
logger.enableConsole(options._all.log);
let res;

async function cronTask() {
	const errs = [];
	res = [];
	try {
		const dailyBackup = await backup.doBackup('daily');
		res.push({
			title: 'Daily Backup',
			value: dailyBackup.msg,
		});
	}
	catch (e) {
		errs.push({
			title: 'Daily Backup',
			value: JSON.stringify(e, Object.getOwnPropertyNames(e), 2),
		});
	}

	try {
		if (errs.length === 0) {
			const dailyDelete = await backup.deleteBackups('daily', cron.daily);
			res.push({
				title: 'Daily Delete',
				value: dailyDelete.msg,
			});
		}
		else {
			errs.push({
				title: 'Daily Delete',
				value: 'Daily backup failed so not doing Daily Delete',
			});
		}
	}
	catch (e) {
		errs.push({
			title: 'Daily Delete',
			value: JSON.stringify(e, Object.getOwnPropertyNames(e), 2),
		});
	}

	if (moment().day() === cron.weekday) {
		logger.log('Weekly stuff running too');
		try {
			const weeklyBackup = await gcs.copyBackup(cron.weekday - 1);
			res.push({
				title: 'Weekly Backup',
				value: weeklyBackup.msg,
			});
		}
		catch (e) {
			errs.push({
				title: 'Weekly Backup',
				value: JSON.stringify(e, Object.getOwnPropertyNames(e), 2),
			});
		}

		try {
			if (errs.filter(err => err.title === 'Weekly Backup').length === 0) {
				const weeklyDelete = await backup.deleteBackups('weekly', cron.weekly);
				res.push({
					title: 'Weekly Delete',
					value: weeklyDelete.msg,
				});
			}
			else {
				errs.push({
					title: 'Weekly Delete',
					value: 'Weekly backup failed so not doing Weekly Delete',
				});
			}
		}
		catch (e) {
			errs.push({
				title: 'Weekly Delete',
				value: JSON.stringify(e, Object.getOwnPropertyNames(e), 2),
			});
		}
	}
	if (errs.length === 0) { logger.console('CRON job done') }
	else { logger.error('CRON job failed\n', errs.map(e => e.value).join('\n')) }

	sendSlack(res, `Cron job report for *${waleHost}*`, errs);
}

async function doCommand(com) {
	try {
		switch (com) {
			case 'size':
				options = options.size;
				res = await gcs.getSize(options.host);
				logger.console(res);
				break;

			case 'list':
				options = options.list;
				res = await backup.getBackups(options.branch, options.host, options.detail);
				logger.console(res.msg, options.detail ? res.data.join('\n') : res.pretty);
				break;

			case 'backup':
				res = await backup.doBackup();
				logger.console(res.msg, '\nBase backup is ', res.data);
				break;

			case 'delete':
				options = options.delete;
				res = await backup.deleteBackups(options.branch, options.retain);
				logger.console(res.msg);
				break;

			case 'restore':
				options = options.restore;
				res = await restore.doRestore(options.branch, options.force,
					options.host, options.base, options.date);
				logger.console(res.msg);
				break;

			case 'copy':
				options = options.copy;
				if (options.branch === 'daily') {
					res = await gcs.copyBackup(options.day);
				}
				else {
					res = await gcs.copyBackup(options.day, 'daily', options.branch);
				}
				logger.console(res.msg);
				logger.debug(res.data);
				break;

			case 'restore-date':
				options = options.restoreDate;
				res = await restore.restoreFromDate(options.date, options.host);
				logger.console(res.msg);
				break;

			case 'cron':
				await cronTask();
				break;
			default:
				console.log(usage);
				break;
		}
	}
	catch (err) {
		logger.error(err);
	}
}

doCommand(command);

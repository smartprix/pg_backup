const {cfg} = require('sm-utils');
const moment = require('moment');
const fsn = require('fs');
const promisify = require('util').promisify;
const {spawn, exec: origExec} = require('child_process');

const Logger = require('./logging');
const {options, getBackups, getGsPrefix, waleSpawn} = require('./backup');

const logger = new Logger('restore');
const exec = promisify(origExec);
const fs = {
	stat: promisify(fsn.stat),
	rename: promisify(fsn.rename),
	unlink: promisify(fsn.unlink),
	writeFile: promisify(fsn.writeFile),
	chown: promisify(fsn.chown),
	readdir: promisify(fsn.readdir),
};

const wale = cfg('wale');
const NOT_EXISTS = -2;

/**
 * @typedef {'daily' | 'weekly'} branches
 */

/**
 * @param {boolean} force if true will rename old pg data directory
 * @returns {Promise<void>}
 */
async function checkPGDATA(force) {
	logger.info(`Checking PGDATA ${wale.pgdata}`);
	try {
		const stat = await fs.stat(wale.pgdata);
		if (stat && force) {
			logger.warn(`A directory already exists at PGDAT ${wale.pgdata}`);
			logger.info('Renaming existing PGDATA directory');

			const d = moment().format('YYYY-MM-DD_HH-mm-ss');
			await fs.rename(wale.pgdata, `${wale.pgdata}_${d}`);

			logger.info(`Successfully renamed old pgdata directory ${wale.pgdata} to ${wale.pgdata}_${d}`);
		}
		else if (stat) {
			throw new Error(`Directory ${wale.pgdata} already exists, rename/move it or use option --force true`);
		}
	}
	catch (err) {
		if (err && err.errno === NOT_EXISTS) {
			logger.info('Checked PGDATA, it does not exist. Continuing.');
		}
		else if (err.errno) {
			logger.error('fs.stat encountered an error', err);
			throw new Error('fs.stat encountered an error');
		}
		else {
			throw err;
		}
	}
}

/**
 * @param {branches} branch
 * @param {string} host
 * @param {string} recoveryTarget
 */
async function createRecovery(branch, host, recoveryTarget) {
	const restoreCommand = `restore_command ='GOOGLE_APPLICATION_CREDENTIALS="${wale.gsAppCreds}" ` +
	`WALE_GS_PREFIX="${wale.gsPrefix}${host}/${branch}" ${wale.path} wal-fetch %f %p'\n` + recoveryTarget;
	logger.info('Creating recovery.conf');
	logger.debug('Contents of recovery.conf:\n' + restoreCommand);

	try {
		await fs.writeFile(wale.pgdata + '/recovery.conf', restoreCommand);
		logger.log('Created recovery.conf');
	}
	catch (err) {
		logger.error('Could not create recovery.conf', err);
		throw new Error('Could not create recovery.conf');
	}

	try {
		await fs.unlink(`${wale.pgdata}/recovery.done`);
		logger.log('Deleted any old recovery.done files');
	}
	catch (err) {
		if (err.errno === NOT_EXISTS) {
			logger.log('No old recovery.done exists. Continuing.');
		}
		else {
			logger.error(err);
			throw new Error('Could not delete old recovery.done');
		}
	}

	try {
		await exec(`chown -R postgres:postgres ${wale.pgdata}`);
		logger.log('Changed owner of', wale.pgdata);
	}
	catch (err) {
		logger.error(err);
		throw new Error('Could not change owner of ' + wale.pgdata);
	}

	logger.info('Successfully created recovery.conf');
}

/**
 * @returns {import('child_process').ChildProcess}
 */
function readPostgresLogs() {
	const files = fsn.readdirSync(cfg('pgsqlLogs'));
	const file = files.sort().reverse()[0];
	const tail = spawn('tail', ['-f', `${cfg('pgsqlLogs')}/${file}`]);
	tail.stdout.on('data', data => logger.info('POSTGRESQL LOG', data.toString()));
	return tail;
}

/**
 * @returns {Promise<void>}
 */
async function checkRecoveryDone() {
	let timer;
	const HALF_MINUTE = 30000;
	const MINUTE = 60000;

	return new Promise((resolve, reject) => {
		const tail = readPostgresLogs();

		const interval = setInterval(() => {
			fsn.stat(`${wale.pgdata}/recovery.done`, (err, stats) => {
				logger.log('Checked for recovery.done');
				if (stats) {
					clearInterval(interval);
					tail.kill();
					clearTimeout(timer);
					logger.info('Recovery complete');
					resolve();
				}
			});
		}, HALF_MINUTE);

		timer = setTimeout(() => {
			clearInterval(interval);
			tail.kill();
			reject(new Error('Failed to detect recovery.done even after 60 minutes.\n' +
				'Check Postgresql logs, maybe recovery is still running'));
		}, 60 * MINUTE);
	});
}

/**
 *
 * @param {branches} branch
 * @param {string} host
 * @param {string} recoveryTarget
 */
async function startRecovery(branch, host, recoveryTarget) {
	logger.info('Start postrgresql recovery process');
	try {
		await createRecovery(branch, host, recoveryTarget);
		const io = await exec('service postgresql start');
		logger.info({label: 'postgres'}, `Postgresql service started\n${io.stdout}\n${io.stderr}`);
		await checkRecoveryDone();
	}
	catch (err) {
		logger.error('recovery failed', err);
		throw new Error(`Recovery could not be completed, please check PGDATA dir ${wale.pgdata}`);
	}
}

/**
 *
 * @param {branches} branch
 * @param {boolean} force
 * @param {string} host
 * @param {string} baseBackup
 * @param {import('moment').Moment} recoveryMoment
 * @returns {Promise<{msg: string}>}
 */
async function doRestore(branch, force, host, baseBackup, recoveryMoment) {
	logger.info('Starting restore function with base backup ' + baseBackup + ' on host ' + wale.host);
	const recoveryTarget = branch === 'weekly' ? '' : `recovery_target_action = promote\nrecovery_target_time = '${recoveryMoment.toISOString()}'\n`;

	try {
		await exec('service postgresql stop');
		logger.info('Postgresql service stopped');
		await checkPGDATA(force);

		await waleSpawn(['--gs-prefix', getGsPrefix(branch, host), 'backup-fetch', wale.pgdata, baseBackup],
			options);

		logger.info('Wal-e backup-fetch command finished. Downloaded and extracted base backup');
		await startRecovery(branch, host, recoveryTarget);
		return {
			msg: `Wal-e restore succesfully done on ${moment().toString()} on host ${wale.host} ` +
				`from base backup ${baseBackup} of ${host}, from branch ${branch} ` +
				`with recovery target ${recoveryMoment.toString()}`,
		};
	}
	catch (err) {
		logger.error('restore failed', err);
		throw new Error(`Restore failed on ${moment().toString()} on host ${host} ` +
			`from base backup ${baseBackup}, from branch ${branch} ` +
			`with recovery target ${recoveryTarget}`);
	}
}

/**
 * @param {import('moment').Moment} momentx
 * @param {branches} branch
 * @param {string} host
 */
async function getLatestBeforeDate(momentx, branch, host) {
	logger.info('Geting the latest backup before date ' + momentx.toString());
	try {
		const daily = await getBackups(branch, host);
		daily.data.sort((a, b) => {
			if (a[1].isBefore(b[1])) {
				return -1;
			}
			else if (a[1].isAfter(b[1])) {
				return 1;
			}
			return 0;
		});
		for (let i = daily.data.length - 1; i >= 0; i--) {
			if (daily.data[i][1].isSameOrBefore(momentx)) {
				logger.info(`Base backup found before ${momentx.toString()}`);
				return daily.data[i][0];
			}
		}
		logger.info(`No backups found in ${branch} before ${momentx.toString()}`);
		return undefined;
	}
	catch (err) {
		logger.error('Failed to get backups', err);
		throw new Error(`Get backup list failed for ${branch} and host ${host}`);
	}
}

/**
 *
 * @param {import('moment').Moment} momentx
 * @param {string} host
 * @returns {Promise<{baseBackup: string, branch: branches}>}
 */
async function getBaseBackup(momentx, host) {
	let baseBackup;
	try {
		baseBackup = await getLatestBeforeDate(momentx, 'daily', host);
		if (baseBackup) {
			return {baseBackup, branch: 'daily'};
		}
	}
	catch (err) {
		//
	}

	try {
		baseBackup = await getLatestBeforeDate(momentx, 'weekly', host);
		if (baseBackup) {
			return {baseBackup, branch: 'weekly'};
		}
	}
	catch (err) {
		//
	}
	throw new Error('No backups found before this date in both weekly and daily branches');
}

/**
 *
 * @param {import('moment').Moment} momentx
 * @param {string} host
 */
async function restoreFromDate(momentx, host) {
	logger.info('Starting restoration from date for host ' + wale.host + ' from ' + host);
	logger.log('Date to restore before: ' + momentx.toString());

	try {
		const {baseBackup, branch} = await getBaseBackup(momentx, host);
		return doRestore(branch, true, host, baseBackup, momentx);
	}
	catch (err) {
		logger.error('Restore failed', err);
		throw new Error(`Restore failed for host ${host} and target ${momentx.toString()}`);
	}
}

module.exports = {
	doRestore,
	restoreFromDate,
};

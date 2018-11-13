const {cfg, file} = require('sm-utils');
const moment = require('moment');
const promisify = require('util').promisify;
const {spawn, execSync, exec: origExec} = require('child_process');

const Logger = require('./logging');

const logger = new Logger('backup');
const exec = promisify(origExec);
const postgresUID = Number.parseInt(execSync('id -u postgres').toString().trim(), 10);

const wale = cfg('wale');
/** @type {import('child_process').SpawnOptions} */
const options = {
	env: {
		GOOGLE_APPLICATION_CREDENTIALS: wale.gsAppCreds,
	},
	uid: postgresUID,
	cwd: '/smartprix',
};

/**
 * @typedef {'daily' | 'weekly'} branches
 */


/**
 * @param {string} branch
 * @param {string} host
 */
function getGsPrefix(branch, host) {
	return wale.gsPrefix + host + '/' + branch;
}

let executableExists;
let gcsConfExists;

/**
 * @returns {Promise<boolean>}
 */
async function waleExists() {
	if (executableExists && gcsConfExists) return true;
	executableExists = await file(wale.path).exists();
	if (!executableExists) {
		logger.console({level: 'warn'}, 'Wal-e not found, is it installed?');
		throw new Error(`Executable ${wale.path} doesn't exist`);
	}

	gcsConfExists = await file(wale.gsAppCreds).exists();
	if (!gcsConfExists) {
		logger.console({level: 'warn'}, `Google credentials not found at path ${wale.gsAppCreds}`);
		throw new Error(`GCS credentials not found at ${wale.path}`);
	}
	return true;
}

/**
 * @param {string} args
 * @param {import('child_process').ExecOptions} options
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
async function waleExec(args, opts = {}) {
	await waleExists();
	try {
		const io = await exec(`${wale.path} ${args}`, opts);
		logger.debug(`\n${io.stdout}`);
		logger.info(`\n${io.stderr}`);
		return io;
	}
	catch (err) {
		if (err.code === 'EPERM') {
			logger.console({level: 'warn'}, 'You don\'t have permission to run wal-e as \'postgres\' user, are you running this as root?');
		}
		throw err;
	}
}

/**
 * first is the basebackup name
 * second is lastModifiedTime
 * third is wal_segment_backup_start
 * fourth is wal_segment_offset_backup_start
 * @typedef {[string, import('moment').Moment, string, string]} backupListItem
 */

/* eslint-disable max-len */
/**
 * first is the basebackup name
 * second is lastModifiedTime
 * third is expanded_size_bytes
 * fourth is wal_segment_backup_start
 * fifth is wal_segment_offset_backup_start
 * sixth is wal_segment_backup_stop
 * seventh is wal_segment_offset_backup_stop
 * @typedef {[string, import('moment').Moment, string, string, string, string, string]} backupListItemDetailed
 */
/* eslint-enable max-len */

/**
 * @param {branches} branch
 * @param {string} host
 * @returns {Promise<{msg: string, pretty: string, data: backupListItem[]}>}
 */
async function getBackups(branch, host, detailed = false) {
	logger.info(`Getting backups for branch ${branch} of ${host}`);
	try {
		const io = await waleExec(`--gs-prefix ${getGsPrefix(branch, host)} backup-list ${detailed ? '--detail' : ''}`, options);

		/** @type {backupListItem[]} */
		const backups = io.stdout
			.split('\r\n')
			.map(item => item
				.split('\t')
				.filter(x => x.length > 0))
			.filter(x => x.length > 0)
			.slice(1)
			.map((item) => {
				item[1] = moment(item[1]);
				return item;
			});

		logger.info('Wal-e backup-list process completed, got backup list');

		return {
			msg: `Got ${branch} backups as on ${moment().toString()} for HOST ${host}\n`,
			pretty: backups.map(item => `\n${item[0]}\t\t${item[1].toString()}`).join(''),
			data: backups,
		};
	}
	catch (err) {
		logger.error({label: 'list'}, 'Wal-e backup-list process failed', err);
		throw new Error(`Failed to get backups for HOST ${host} in branch ${branch}`);
	}
}

/**
 * @param {branches} branch
 * @param {string} host
 * @returns {Promise<{msg: string, pretty: string, data: backupListItemDetailed[]}>}
 */
async function getBackupsDetailed(branch, host) {
	return getBackups(branch, host, true);
}

/**
 * Logs all output and returns on completion of command
 * @param {string} args args for wale
 * @param {import('child_process').SpawnOptions} opts will be passed to spawn
 * @param {(info: string) => void} [errFn]
 * @returns {Promise<void>}
 */
async function waleSpawn(args, opts, errFn = () => {}) {
	await waleExists();
	return new Promise(async (resolve, reject) => {
		const cSpawn = spawn(wale.path, args, opts);
		let err = '';

		cSpawn.stdout.on('data', data => logger.debug(`\n${data.toString()}`));

		cSpawn.stderr.on('data', (data) => {
			const info = data.toString();
			logger.info(`\n${info}`);
			err = info;
			errFn(info);
		});

		cSpawn.on('close', (code) => {
			if (code !== 0) {
				if (code === 'EPERM') {
					logger.console({level: 'warn'}, 'You don\'t have permission to run wal-e as \'postgres\' user, are you running this as root?');
				}
				else logger.console({level: 'warn'}, 'POSTGRESQL MIGHT BE OFF, PLEASE RESTART IT');
				reject(new Error('WAL-E LOG: ' + err + '\nError Code: ' + code));
			}
			else {
				resolve();
			}
		});

		cSpawn.on('exit', (code, signal) => {
			logger.log(`Child process exited with code ${code}, ${signal}`);
		});
	});
}

/**
 * @returns {Promise<{msg: string, data: string}>}
 */
async function doBackup() {
	const branch = 'daily';
	let baseBackup = '';
	let doLookUp = true;
	const lookUp = `DETAIL: Uploading to ${wale.gsPrefix}${wale.host}/${branch}/basebackups_005/`;

	logger.info(`Doing backup for branch ${branch} of host ${wale.host}`);

	try {
		await waleSpawn(['--gs-prefix', getGsPrefix(branch, wale.host), 'backup-push', wale.pgdata],
			options, (info) => {
				if (doLookUp && info.indexOf(lookUp) !== -1) {
					baseBackup = info.substr(info.indexOf(lookUp) + lookUp.length, 38);
					doLookUp = false;
				}
			}
		);
		logger.info('Wal-e backup push process finished. Backup successful');
		return {
			msg: `Backup: ${baseBackup}, completed on ${moment().toString()} for host ${wale.host}, branch ${branch}.`,
			data: baseBackup,
		};
	}
	catch (err) {
		throw new Error(`Backup: Failed on ${moment().toString()} for HOST ${wale.host}, branch ${branch}\n` + err);
	}
}

/**
 *
 * @param {string} branch
 * @param {number} olderThan
 * @param {number} total
 * @returns {Promise<{msg: string}>}
 */
async function waleDelete(branch, olderThan, total) {
	logger.info('Wal-e delete process starting up');
	try {
		let subComm = ['retain', olderThan];
		if (olderThan === 0) {
			subComm = ['everything'];
		}
		await waleSpawn(['--gs-prefix', getGsPrefix(branch, wale.host), 'delete', '--confirm', ...subComm], options);
		return {msg: `Deletion: Deleted the oldest ${total - olderThan} backups, retained ${olderThan} for host ${wale.host}, branch ${branch}`};
	}
	catch (err) {
		throw new Error(`Deletion: Wal-e failed to delete backups for host ${wale.host}, branch ${branch}\n` + err);
	}
}

/**
 * @param {string} branch
 * @param {number} olderThan
 * @returns {Promise<{msg: string}>}
 */
async function deleteBackups(branch, olderThan) {
	logger.info(`Deleting backups for branch ${branch} of host ${wale.host}, retaining ${olderThan}`);
	try {
		const backups = await getBackups(branch, wale.host);
		// TODO: check date before deletion
		if (backups.data.length <= olderThan) {
			logger.info('Wal-e delete skipped');
			return {msg: `Deletion: Number of backups (${backups.data.length}) are not more than ${olderThan} for host ${wale.host}, branch ${branch}`};
		}
		return await waleDelete(branch, olderThan, backups.data.length);
	}
	catch (err) {
		logger.error({label: 'delete'}, err);
		throw new Error(`Deletion for branch ${branch} failed.`);
	}
}

// TODO: Add -m manual command to directly pass arguments to wal-e

module.exports = {
	options,
	getGsPrefix,
	getBackups,
	getBackupsDetailed,
	waleSpawn,
	doBackup,
	deleteBackups,
};

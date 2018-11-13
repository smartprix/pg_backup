const {cfg, file} = require('sm-utils');
const moment = require('moment');
const promisify = require('util').promisify;
const {spawn, execSync, exec: origExec} = require('child_process');

const logger = require('./logging');

const exec = promisify(origExec);
const postgresUID = Number.parseInt(execSync('id -u postgres').toString().trim(), 10);

const wale = cfg('wale');
const options = {
	env: {
		GOOGLE_APPLICATION_CREDENTIALS: wale.gsAppCreds,
	},
	uid: postgresUID,
	cwd: '/smartprix',
};

function getGsPrefix(branch, host) {
	return wale.gsPrefix + host + '/' + branch;
}

async function getBackups(branch, host, detailed = false) {
	logger.info(`Getting backups for branch ${branch} of ${host}`);
	try {
		const io = await exec(`${wale.path} --gs-prefix ${getGsPrefix(branch, host)} backup-list ${detailed ? '--detail' : ''}`, options);
		logger.debug(io.stdout);
		logger.info(io.stderr);
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
		logger.info('Wal-e backup-list process failed');
		throw new Error(`Failed to get backups for HOST ${host} in branch ${branch}\n` + err);
	}
}

async function customSpawn(command, args, opts, errFn = () => {}) {
	return new Promise(async (resolve, reject) => {
		const executableExists = await file(command).exists();
		if (!executableExists) reject(new Error(`Executable ${command} doesn't exist`));
		const cSpawn = spawn(command, args, opts);
		let err = '';

		cSpawn.stdout.on('data', data => logger.debug(data.toString()));
		cSpawn.stderr.on('data', (data) => {
			const info = data.toString();
			logger.info(info);
			err = info;
			errFn(info);
		});

		cSpawn.on('close', (code) => {
			if (code !== 0) {
				logger.console('POSTGRESQL MIGHT BE OFF, PLEASE RESTART IT');
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

async function doBackup() {
	const branch = 'daily';
	logger.info(`Doing backup for branch ${branch} of host ${wale.host}`);
	let baseBackup = '';
	let doLookUp = true;
	const lookUp = `DETAIL: Uploading to ${wale.gsPrefix}${wale.host}/${branch}/basebackups_005/`;

	try {
		await customSpawn(wale.path, ['--gs-prefix', getGsPrefix(branch, wale.host), 'backup-push', wale.pgdata],
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

async function waleDelete(branch, olderThan, total) {
	logger.info('Wal-e delete process starting up');
	try {
		let subComm = ['retain', olderThan];
		if (olderThan === 0) {
			subComm = ['everything'];
		}
		await customSpawn(wale.path, ['--gs-prefix', getGsPrefix(branch, wale.host), 'delete', '--confirm', ...subComm], options);
		return {msg: `Deletion: Deleted the oldest ${total - olderThan} backups, retained ${olderThan} for host ${wale.host}, branch ${branch}`};
	}
	catch (err) {
		throw new Error(`Deletion: Wal-e failed to delete backups for host ${wale.host}, branch ${branch}\n` + err);
	}
}

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
		throw new Error(`Deletion for branch ${branch} failed.\n` + err);
	}
}

// TODO: Add -m manual command to directly pass arguments to wal-e

module.exports = {
	options,
	getGsPrefix,
	getBackups,
	customSpawn,
	doBackup,
	deleteBackups,
};

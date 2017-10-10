const config = require('config');
const userid = require('userid');
const moment = require('moment');
const logger = require('./logging');
const spawn = require('child_process').spawn;
const promisify = require('util').promisify;
const exec = promisify(require('child_process').exec);

const wale = config.get('wale');
const postgresUID = userid.uid('postgres');
const options = {
	env: {
		GOOGLE_APPLICATION_CREDENTIALS: wale.gsAppCreds,
	},
	uid: postgresUID,
};

function getGsPrefix(branch, host) {
	return wale.gsPrefix + host + '/' + branch;
}

async function getBackups(branch, host, detailed = false) {
	logger.trace(`Getting backups for branch ${branch} of ${host}`);
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
		logger.trace('Wal-e backup-list process completed, got backup list');
		return {
			msg: `Got ${branch} backups as on ${moment().toString()} for HOST ${host}\n`,
			pretty: backups.map(item => `\n${item[0]}\t\t${item[1].toString()}`).join(''),
			data: backups,
		};
	}
	catch (err) {
		logger.trace('Wal-e backup-list process failed');
		throw new Error(`Failed to get backups for HOST ${host} in branch ${branch}\n` + err);
	}
}

function customSpawn(command, args, opts, errFn) {
	return new Promise((resolve, reject) => {
		const cSpawn = spawn(command, args, opts);
		let err = '';

		cSpawn.stdout.on('data', data => logger.debug(data.toString()));
		cSpawn.stderr.on('data', (data) => {
			const info = data.toString();
			logger.info(info);
			err += info;
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
	logger.trace(`Doing backup for branch ${branch} of host ${wale.host}`);
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
		logger.trace('Wal-e backup push process finished. Backup successful');
		return {
			msg: `${branch} Backup: Succesfully done on ${moment().toString()} for host ${wale.host}.`,
			data: baseBackup,
		};
	}
	catch (err) {
		throw new Error(`${branch} Backup: Failed on ${moment().toString()} for HOST ${wale.host}\n` + err);
	}
}

async function waleDelete(branch, olderThan) {
	logger.trace('Wal-e delete process starting up');
	try {
		let subComm = `retain ${olderThan}`;
		if (olderThan === 0) {
			subComm = 'everything';
		}
		const io = await exec(`${wale.path} --gs-prefix ${getGsPrefix(branch, wale.host)} delete --confirm ${subComm}`, options);
		logger.debug(io.stdout);
		logger.info(io.stderr);
		return {msg: `${branch} Deletion: Retained the latest ${olderThan} backups for host ${wale.host}`};
	}
	catch (err) {
		throw new Error(`${branch} Deletion: Wal-e failed to delete backups for host ${wale.host}\n` + err);
	}
}

async function deleteBackups(branch, olderThan) {
	logger.trace(`Deleting backups for branch ${branch} of host ${wale.host}, retaining ${olderThan}`);
	try {
		const backups = await getBackups(branch, wale.host);
		// TODO: check date before deletion
		if (backups.data.length <= olderThan) {
			logger.trace('Wal-e delete skipped');
			return {msg: `${branch} Deletion: Number of backups are not more than ${olderThan} for host ${wale.host}`};
		}
		return await waleDelete(branch, olderThan);
	}
	catch (err) {
		throw new Error(`${branch} Deletion:` + err);
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

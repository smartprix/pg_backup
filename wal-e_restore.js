const config = require('config');
const moment = require('moment');
const fsn = require('fs');
const promisify = require('util').promisify;
const spawn = require('child_process').spawn;
const exec = promisify(require('child_process').exec);
const logger = require('./logging');
const {options, getBackups, getGsPrefix, customSpawn} = require('./wal-e_backup');

const fs = {
	stat: promisify(fsn.stat),
	rename: promisify(fsn.rename),
	unlink: promisify(fsn.unlink),
	writeFile: promisify(fsn.writeFile),
	chown: promisify(fsn.chown),
	readdir: promisify(fsn.readdir),
};

const wale = config.get('wale');
const NOT_EXISTS = -2;

async function checkPGDATA(force) {
	logger.trace(`Checking PGDATA ${wale.pgdata}`);
	try {
		const stat = await fs.stat(wale.pgdata);
		if (stat && force) {
			logger.warn(`A directory already exists at PGDAT ${wale.pgdata}`);
			logger.trace('Renaming existing PGDATA directory');

			const d = moment().format('YYYY-MM-DD_HH-mm-ss');
			await fs.rename(wale.pgdata, `${wale.pgdata}_${d}`);

			logger.trace(`Successfully renamed old pgdata directory ${wale.pgdata} to ${wale.pgdata}_${d}`);
		}
		else if (stat) {
			throw new Error(`Directory ${wale.pgdata} already exists, rename/move it or use option --force true`);
		}
	}
	catch (err) {
		if (err && err.errno === NOT_EXISTS) {
			logger.trace('Checked PGDATA, it does not exist. Continuing.');
		}
		else if (err.errno) {
			throw new Error('fs.stat encountered an error\n' + err);
		}
		else {
			throw err;
		}
	}
}

async function createRecovery(branch, host, recoveryTarget) {
	const restoreCommand = `restore_command ='GOOGLE_APPLICATION_CREDENTIALS="${wale.gsAppCreds}" ` +
	`WALE_GS_PREFIX="${wale.gsPrefix}${host}/${branch}" ${wale.path} wal-fetch %f %p'\n` + recoveryTarget;
	logger.trace('Creating recovery.conf');
	logger.debug('Contents of recovery.conf: ' + restoreCommand);

	try {
		await fs.writeFile(wale.pgdata + '/recovery.conf', restoreCommand);
		logger.log('Created recovery.conf');
	}
	catch (err) {
		throw new Error('Could not create recovery.conf\n' + err);
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
			throw new Error('Could not delete old recovery.done\n' + err);
		}
	}

	try {
		await exec(`chown -R postgres:postgres ${wale.pgdata}`);
		logger.log('Changed owner of', wale.pgdata);
	}
	catch (err) {
		throw new Error('Could not change owner of ' + wale.pgdata + '\n' + err);
	}

	logger.trace('Successfully created recovery.conf');
}

function readPostgresLogs() {
	const files = fsn.readdirSync(config.get('pgsqlLogs'));
	const file = files.sort().reverse()[0];
	const tail = spawn('tail', ['-f', `${config.get('pgsqlLogs')}/${file}`]);
	tail.stdout.on('data', data => logger.info('POSTGRESQL LOG', data.toString()));
	return tail;
}

function checkRecoveryDone() {
	let timer;
	const HALF_MINUTE = 30000;
	const MINUTE = 60000;

	return new Promise((resolve, reject) => {
		const tail = readPostgresLogs();

		const interval = setInterval(() => {
			fs.stat(`${wale.pgdata}/recovery.done`, (err, stats) => {
				logger.log('Checked for recovery.done');
				if (stats) {
					clearInterval(interval);
					tail.kill();
					clearTimeout(timer);
					logger.trace('Recovery complete');
					resolve();
				}
			});
		}, HALF_MINUTE);

		timer = setTimeout(() => {
			clearInterval(interval);
			tail.kill();
			reject(new Error('Failed to detect recovery.done even after 30 minutes.\n' +
				'Check Postgresql logs, maybe recovery is still running'));
		}, 60 * MINUTE);
	});
}

async function startRecovery(branch, host, recoveryTarget) {
	logger.trace('Start postrgresql recovery process');
	try {
		await createRecovery(branch, host, recoveryTarget);
		const io = await exec('service postgresql start');
		logger.trace('Postgresql service started', io.stdout);
		await checkRecoveryDone();
	}
	catch (err) {
		throw new Error(`Recovery could not be completed, please check PGDATA dir ${wale.pgdata}\n` + err);
	}
}

async function doRestore(branch, force, host, baseBackup, recoveryMoment) {
	logger.trace('Starting restore function with base backup ' + baseBackup + ' on host ' + wale.host);
	const recoveryTarget = branch === 'weekly' ? '' : `recovery_target_action = promote\nrecovery_target_time = '${recoveryMoment.toISOString()}'\n`;

	try {
		await exec('service postgresql stop');
		logger.trace('Postgresql service stopped');
		await checkPGDATA(force);

		await customSpawn(wale.path,
			['--gs-prefix', getGsPrefix(branch, host), 'backup-fetch', wale.pgdata, baseBackup],
			options, () => {});

		logger.trace('Wal-e backup-fetch command finished. Downloaded and extracted base backup');
		await startRecovery(branch, host, recoveryTarget);
		return {
			msg: `Wal-e restore succesfully done on ${moment().toString()} on host ${wale.host} ` +
				`from base backup ${baseBackup} of ${host}, from branch ${branch} ` +
				`with recovery target ${recoveryMoment.toString()}`,
		};
	}
	catch (err) {
		throw new Error(`Restore failed on ${moment().toString()} on host ${host} ` +
			`from base backup ${baseBackup}, from branch ${branch} ` +
			`with recovery target ${recoveryTarget}\n${err}`);
	}
}

async function getLatestBeforeDate(momentx, branch, host) {
	logger.trace('Geting the latest backup before date ' + momentx.toString());
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
				logger.trace(`Base backup found before ${momentx.toString()}`);
				return daily.data[i][0];
			}
		}
		logger.trace(`No backups found in ${branch} before ${momentx.toString()}`);
		return undefined;
	}
	catch (err) {
		throw new Error(`Get backup list failed for ${branch} and host ${host}\n` + err);
	}
}

async function getBaseBackup(momentx, host) {
	try {
		let baseBackup = await getLatestBeforeDate(momentx, 'daily', host);
		if (baseBackup) {
			return {baseBackup, branch: 'daily'};
		}
		baseBackup = await getLatestBeforeDate(momentx, 'weekly', host);
		if (baseBackup) {
			return {baseBackup, branch: 'weekly'};
		}
	}
	catch (err) {
		throw new Error('Get latest backup before date failed\n' + err);
	}
	throw new Error('No backups found before this date in both weekly and daily branches');
}

async function restoreFromDate(momentx, host) {
	logger.trace('Starting restoration from date for host ' + wale.host + ' from ' + host);
	logger.log('Date to restore before: ' + momentx.toString());

	try {
		const {baseBackup, branch} = await getBaseBackup(momentx, host);
		const out = await doRestore(branch, true, host, baseBackup, momentx);
		return out;
	}
	catch (err) {
		throw new Error('Get latest backup before date failed\n' + err);
	}
}

module.exports = {
	doRestore,
	restoreFromDate,
};

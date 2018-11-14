const {cfg} = require('sm-utils');
const moment = require('moment');
const promisify = require('util').promisify;
const exec = promisify(require('child_process').exec);
const Logger = require('./logging');
const {getBackupsDetailed} = require('./backup');

const logger = new Logger('gcs');
const wale = cfg('wale');
const gsutil = '/usr/local/bin/gsutil';

/**
 * @typedef {'daily' | 'weekly'} branches
 */

/**
 * 24 chracter string
 * contains 3 strings of size 9, denoting wal files names
 * @see https://codemix.com/opaque-types-in-javascript/
 * @typedef {Opaque<'walFileName', string>} walFileName
 */

/**
 * @param {string} [host]
 * @returns {Promise<string>}
 */
async function getSize(host = wale.host) {
	logger.info('Getting size of backups for host:', host);
	const hostPrefix = wale.gsPrefix + '/' + host + '/**';
	try {
		const io = await exec(`${gsutil} -m ls -l ${hostPrefix} | grep TOTAL`);
		logger.info(io.stderr);
		return io.stdout;
	}
	catch (err) {
		throw new Error('Gsutil "ls" failed\n' + err);
	}
}

/**
 *
 * @param {string} file
 * @param {branches} srcBranch
 * @param {branches} destBranch
 * @returns {Promise<string>}
 */
async function copyFile(file, srcBranch, destBranch) {
	const newFile = file.toString().replace(srcBranch, destBranch);
	try {
		const io = await exec(`${gsutil} -m cp ${file} ${newFile}`);
		logger.info(io.stderr);
		logger.log(`Successfully copied file ${file} to ${newFile}\n${io.stdout}`);
		return newFile;
	}
	catch (err) {
		throw new Error('Could not copy file ' + file + '\n' + err);
	}
}
/** @typedef {[number, number]} pair */

/**
 * @param {walFileName} walStart
 * @param {pair} walNext
 * @returns {string}
 */
function fromPairtoString(walStart, walNext) {
	const l = walNext[0].toString(16);
	const h = walNext[1].toString(16);
	return walStart.substr(0, 8) +
		h.padStart(8, '0').toUpperCase() + l.padStart(8, '0').toUpperCase();
}

/**
 * returns done when start and end are equal or end is greater than start
 * @see https://www.postgresql.org/message-id/5a0a9d6f0805141425h6ffff039j414dbeb3c77ef0b1%40mail.gmail.com
 * @param {pair} start
 * @param {pair} end
 * @returns {pair | 'DONE'}
 */
function lessThan(start, end) {
	const MAX = 0x000000FF;
	if (start[1] === end[1] && end[0] > start[0]) {
		start[0] += 1;
		return start;
	}
	else if (end[1] > start[1]) {
		if (start[0] === MAX) {
			start = [0, start[1] + 1];
		}
		else {
			start[0] += 1;
		}
		return start;
	}
	return 'DONE';
}

/**
 * @param {walFileName} wal 24 char string
 * @returns {pair}
 */
function toPair(wal) {
	const h = parseInt(wal.substr(8, 8), 16);
	const l = parseInt(wal.substr(16, 8), 16);
	return [l, h];
}

/**
 * @param {walFileName} walStart
 * @param {walFileName} walEnd
 * @param {branches} srcBranch
 * @returns {string[]}
 */
function getAllWalFiles(walStart, walEnd, srcBranch) {
	logger.info('Getting all WAL files corresponding to the base backup');
	logger.log('Wal start', walStart, '\nWal end', walEnd);

	/** @type {pair | 'DONE'} */
	let tmp = toPair(walStart);

	const e = toPair(walEnd);
	const walPrefix = wale.gsPrefix + '/' + wale.host + '/' + srcBranch + '/wal_005/';
	const files = [];

	do {
		const fileName = walPrefix + fromPairtoString(walStart, tmp) + '.lzo';
		files.push(fileName);
		tmp = lessThan(tmp, e);
	} while (tmp !== 'DONE');

	logger.log('Got WAL files, number:', files.length);
	return files;
}

/**
 * @param {string} baseBackup
 * @param {branches} srcBranch
 * @returns {Promise<string[]>} files
 */
async function getAllBaseFiles(baseBackup, srcBranch) {
	logger.info('Getting base files');
	const dailyPrefix = wale.gsPrefix + '/' + wale.host + '/' + srcBranch + '/basebackups_005/';
	try {
		const io = await exec(`${gsutil} -m ls -r ${dailyPrefix + baseBackup}**`);
		logger.debug(io.stderr);
		const files = io.stdout.split('\n').filter(val => val.length > 0);
		if (files.length === 0) {
			throw new Error('Got an empty list of files in backup dir');
		}
		logger.info('Got base files, number:', files.length);
		return files;
	}
	catch (err) {
		throw new Error('gsutil ls encountered an err\n' + err);
	}
}

/**
 * @param {{base: string, walStart: walFileName, walEnd: walFileName}} backup
 * @param {branches} srcBranch
 * @param {branches} destBranch
 * @returns {Promise<string[]>} files copied
 */
async function copyAllFiles(backup, srcBranch, destBranch) {
	logger.info('Getting all files to copy');
	try {
		const baseFiles = await getAllBaseFiles(backup.base, srcBranch);
		const walFiles = getAllWalFiles(backup.walStart, backup.walEnd, srcBranch);
		const files = Array.prototype.concat(walFiles, baseFiles);
		logger.info('Starting copying files');
		return Promise.all(files.map(file => copyFile(file, srcBranch, destBranch)));
	}
	catch (err) {
		throw new Error(`Could not copy all files.\n${err}`);
	}
}

/**
 * @param {number} day Number representing day of week
 * @param {branches} srcBranch
 * @param {branches} destBranch
 */
async function copyBackup(day = 6, srcBranch = 'daily', destBranch = 'weekly') {
	logger.info('Starting copy backup function for day ', moment().day(day).toString());

	try {
		const backups = await getBackupsDetailed(srcBranch, wale.host);
		backups.data = backups.data.filter((item) => {
			if (item[1].isSame(moment().day(day), 'day')) {
				return true;
			}
			return false;
		}).sort((a, b) => {
			if (a[1].isBefore(b[1])) {
				return 1;
			}
			else if (a[1].isAfter(b[1])) {
				return -1;
			}
			return 0;
		});
		if (backups.data.length === 0) {
			throw new Error('Weekly Backup: Skipped. No daily backup found for the weekday ' + moment().day(day).toString());
		}
		const baseBackup = {
			base: backups.data[0][0],
			walStart: backups.data[0][3],
			walEnd: backups.data[0][5],
		};
		logger.info('Got backup for day', day, ':', baseBackup);
		const copiedFiles = await copyAllFiles(baseBackup, srcBranch, destBranch);
		return {
			msg: `Backup: Copied ${srcBranch} backup ${baseBackup.base} and ` +
			`corresponding wal files to ${destBranch}, no. of files : ${copiedFiles.length}`,
			data: copiedFiles,
		};
	}
	catch (err) {
		throw err;
	}
}

module.exports = {
	getAllWalFiles,
	copyBackup,
	getSize,
};

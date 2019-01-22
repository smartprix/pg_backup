const Webhook = require('@slack/client').IncomingWebhook;
const {cfg} = require('sm-utils');
const logger = require('./logging');

/** @type {Webhook} */
let slack;

function getSlackWebhook() {
	if (slack) return slack;
	slack = new Webhook(cfg('pg.slack.webhook'));
	return slack;
}

/**
 * @param {string} title
 * @param {{title: string, value: string}[]} msgs
 * @param {{title: string, value: string}[]} errs
 * @returns {Promise<void>}
 */
async function sendSlack(title, msgs, errs = []) {
	/** @type {import('@slack/client').IncomingWebhookSendArguments} */
	const payload = {
		username: 'Postgres-Backup-Status',
		icon_emoji: ':floppy_disk:',
		channel: cfg('pg.slack.channel'),
		attachments: [
			{
				pretext: title,
				color: 'good',
				fallback: 'Postgres Backup Status:\n',
				fields: msgs,
			},
		],
	};
	if (errs.length !== 0) {
		payload.attachments.push({
			pretext: 'Failures: ',
			color: 'danger',
			fallback: 'Postgres Backup Errors:\n',
			fields: errs,
		});
	}
	let res;
	try {
		res = await getSlackWebhook().send(payload);
		logger.info({label: 'Slack', errs: errs.length, msgs: msgs.length}, 'Sent slack msg. Received', res.text, 'from Slack.');
	}
	catch (err) {
		// @ts-ignore
		logger.error({label: 'Slack', errs: errs.length, msgs: msgs.length, url: getSlackWebhook().url}, title, err, err.original);
	}
}

module.exports = sendSlack;

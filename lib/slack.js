const Webhook = require('@slack/client').IncomingWebhook;
const {cfg} = require('sm-utils');
const logger = require('./logging');

const slack = new Webhook(cfg('pg.slack.webhook'));

function sendSlack(msgs, title, errs) {
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
	slack.send(payload, (error, header, statusCode) => {
		if (error) {
			logger.error(error);
		}
		else {
			logger.info('Sent slack msg. Received', statusCode, 'from Slack.\n');
		}
	});
}

module.exports = sendSlack;

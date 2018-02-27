const Webhook = require('@slack/client').IncomingWebhook;
const config = require('config').get('pg').slack;
const logger = require('./logging');

const slack = new Webhook(config.webhook);

function sendSlack(msgs, title, errs) {
	const payload = {
		username: 'Postgres-Backup-Status',
		icon_emoji: ':bar_chart:',
		channel: config.channel,
		attachments: [
			{
				pretext: title,
				color: 'good',
				fallback: 'Pstgres Backup Status:\n',
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
			logger.trace('Sent slack msg. Received', statusCode, 'from Slack.\n');
		}
	});
}

module.exports = sendSlack;

const Webhook = require('@slack/client').IncomingWebhook;
const config = require('config').get('pg').slack;
const logger = require('./logging');

const slack = new Webhook(config.webhook);

function sendSlack(msg, title, pretext, err) {
	const uMsg = msg.charAt(0).toUpperCase() + msg.slice(1);
	const payload = {
		username: 'Postgres-Backup-Status',
		icon_emoji: ':bar_chart:',
		channel: config.channel,
		attachments: [
			{
				pretext,
				color: 'good',
				fallback: title + '\n' + uMsg,
				fields: [
					{
						title,
						value: uMsg,
						short: false,
					},
				],
			},
		],
	};
	if (err) {
		payload.attachments[0].color = 'danger';
		payload.attachments[0].fields.push({
			title: 'Error:',
			value: err,
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

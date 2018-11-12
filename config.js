const os = require('os');

module.exports = {
	pg: {
		logDir: '/smartprix/logs/pg_backup',
		slack: {
			channel: '@dev-events',
			webhook: 'https://hooks.slack.com/services/XXXXXXXXX/XXXXXXXXX/XXXXXXXXXXXXXXXXXXXXXXXX',
		},
		gcs: {
			bucket: 'postgresql-test1-backups',
		},
		cron: {
			daily: 8, // keep how many daily backups
			weekly: 12, // keep how naby weekly backups
			weekday: 6, // which weekday to copy backup on
		},
	},
	wale: {
		host: os.hostname(),
		gsPrefix: 'gs://postgresql-test1-backups/',
		gsAppCreds: '/smartprix/conf/gsAppCreds.json',
		pgdata: '/var/lib/postgresql/10/main',
	},
	pgsqlLogs: '/smartprix/logs/pgsql',
};


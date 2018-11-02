module.exports = {
	pg: {
		logDir: '/smartprix/logs/server_logs/postgres_backup',
		slack: {
			channel: '@dev-events',
			webhook: 'https://hooks.slack.com/services/XXXXXXXXX/XXXXXXXXX/XXXXXXXXXXXXXXXXXXXXXXXX',
		},
		gcs: {
			bucket: 'postgres_backup1',
		},
		cron: {
			daily: 8,
			weekly: 12,
			weekday: 6,
		},
	},
	wale: {
		host: '',
		gsPrefix: 'gs://backup-postgres/',
		gsAppCreds: '/var/lib/postgres_backup/config/gsAppCreds.json',
		pgdata: '/var/lib/postgresql/10/main',
	},
	pgsqlLogs: '',
};


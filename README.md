# Postgres Backup Utility

A node utility to manage PstgreSQL backups on Google Cloud Storage.
It uses wal-e (http://github.com/wal-e/wal-e) to peform restores, backups, and cleanups.

It is meant to be used with 2 backup branches: 'daily' & 'weekly' and **run as root**.

The 'daily' branch is to be setup with continuos wal-archiving plus daily base backups.
The 'weekly' branch will have only weekly base backups and the corresponding required WAL archives to bring those backups into a consistent state, copied from the daily branch.

## Configs

### GCS

Create a project and a [storage bucket](https://console.cloud.google.com/storage/browser) in the project on Google Cloud Console.

Make a [service account](https://console.cloud.google.com/iam-admin/serviceaccounts/) with permission to modify the Storage bucket you created and export it's credentials as a json.

### default.json

In the config folder

The structure of the file should be :

	{	
		"pg": {
			"scriptParDir": '/var/lib',
			"scriptDir": '/var/lib/postgres_backup',
			"logDir": "/smartprix/logs/server_logs/postgres_backup/",
			"slack": {
				"channel": '@dev-events',
				"webhook": 'https://hooks.slack.com/services/XXXXXXXXX/XXXXXXXXX/XXXXXXXXXXXXXXXXXXXXXXXX'
			},
			"gcs": {
				"bucket": "postgres_backup1"  
			},
			"cron": {
				"daily": 8,
				"weekly": 12,
				"weekday": 6
			} 
		},
		"wale": {
			"host": '{ hostname }',
			"gsPrefix": "gs://backup-postgres/",
			"gsAppCreds": "/var/lib/postgres_backup/config/gsAppCreds.json",
			"pgdata": "/var/lib/postgresql/9.6/main"
		} 
	}


### /root/.boto for gsutil

Will be required to be configured before hand using this tool.

## GCS Structure

	gs://bucket
	  -|/
	    -|HOST_1
	      -|daily
	        -|basebackups_005
              -|base_0000000X0000000X000000XX_000000X0
                -|tar_partitions
                  -|part_0000000X.tar.lzo
	        -|wal_005
              -|0000000X0000000X000000XX.lzo
	      -|weekly
	        -|basebackups_005
              -|base_0000000X0000000X000000XX_000000X0
                -|tar_partitions
                  -|part_0000000X.tar.lzo
            -|wal_005
              -|0000000X0000000X000000XX.lzo
        -|....
        -|HOST_N
          -|daily
            -|basebackups_005
              -|base_0000000X0000000X000000XX_000000X0
                -|tar_partitions
                  -|part_0000000X.tar.lzo
            -|wal_005
              -|0000000X0000000X000000XX.lzo
          -|weekly
            -|basebackups_005
              -|base_0000000X0000000X000000XX_000000X0
                -|tar_partitions
                  -|part_0000000X.tar.lzo
            -|wal_005
              -|0000000X0000000X000000XX.lzo

## Requirements

1. Node and npm
2. Postgresql
3. python3, python2 and corresponding pip
4. wal-e[google], version 1.0.3
	
		pip3 install wal-e[google]
5. gsutil, version 4.7
	
		pip2 install gsutil
6. google-apitools, version 0.5.15 (The current gsutil has an error because of older pinned google-apitools)

## Commands:

	[] = Optional options

The optional arguments cannot have spaces in them.

### Get Backups

	pg_backup list [--branch BRANCH --host HOST]

Get list of backups in the specified branch and for the specified host.

eg.:

	pg_backup list --branch weekly --host smpx-170l

or

	pg_backup list

which will default to:

	pg_backup list --branch daily --host SELF
	Output: 2017-10-04T15:35:56+0530 <log> 
	base_0000000B000000070000000C_00000040		Fri Sep 29 2017 10:24:01 GMT+0530
	base_0000000B000000080000000F_00000040		Fri Sep 29 2017 14:43:05 GMT+0530
	base_0000000B0000000800000023_00000040		Fri Sep 29 2017 15:02:27 GMT+0530
	base_0000000B000000080000002A_00000040		Fri Sep 29 2017 15:09:10 GMT+0530
	base_0000000B000000080000003C_00000040		Fri Sep 29 2017 15:26:43 GMT+0530
	base_0000000B000000080000004B_00000040		Fri Sep 29 2017 15:40:10 GMT+0530
	base_0000000B000000080000005F_00000040		Fri Sep 29 2017 15:58:56 GMT+0530
	base_0000001000000008000000C0_00000040		Tue Oct 03 2017 11:47:45 GMT+0530 

where SELF is the hostname of the system the script is running on.

### Do a Backup

	pg_backup backup

Make a base backup and upload to the daily branch. If you want to do a backup to any other branch, do this first then use the weekly option.

eg.

	pg_backup backup
	Output: 2017-10-04T17:33:48+0530 <log> daily Backup: Succesfully done on Wed Oct 04 2017 17:33:48 GMT+0530 for host rohit-hp. Backup : base_0000001300000008000000A0_00000040


### Delete backups while retaining N

	pg_backup delete [--branch BRANCH --retain N]

Deletes older backups while retaining the latest N backups

eg.

	pg_backup delete --retain 7
	Output:2017-10-04T15:37:53+0530 <log> daily Deletion: Retained the latest 7 backups for host rohit-hp


### Restore from Base Backup

	pg_backup restore [--branch BRANCH --base BACKUP_NAME --date DATE --force BOOL --host HOST]

Restore from the specified base backup (also accepts LATEST param) in the specified branch of the specified host (useful to clone other hosts from their backups). If a date is specified, it will set that as the recovery_target in 'recovery.conf' of Postgres while restoring. If a directory already exists at PGDATA it will fail by default, use 'force' option to change behaviour.

### Restore from date

	pg_backup -R [--date DATE --host HOST]

Restore from a date. It will try to find the latest base backup before or on the specified date, first in the 'daily' branch then the 'weekly' branch. After that will restore from that upto to the specified date. Will rename any existing directory at PGDATA.

eg.

	pg_backup -R

which will default to

	pg_backup -R --date NOW --host SELF
	Output: Wal-e restore succesfully done on Wed Oct 04 2017 16:31:52 GMT+0530 on host rohit-hp from base backup base_0000000B000000080000005F_00000040 of rohit-hp, from branch daily with recovery target recovery_target_time = '2017-10-04T10:57:58.246Z'

where SELF is hostname of system, and 'NOW' will set the date as the current time.

### Copy Day's backup to Weekly branch

	pg_backup copy [--day WEEKDAY --branch DEST_BRANCH]

Find the latest backup on the specified day of the current week in the 'daily' branch and copy it to the specified branch(default:'weekly') directly in the cloud using gsutil.

eg.

	pg_backup copy --day -2
	Output: Weekly Backup: Copied daily backup base_0000000B000000080000005F_00000040 and corresponding wal files to weekly, no. of files : 5
	[ 'gs://backup-postgres//rohit-hp/weekly/wal_005/0000000B000000080000005F.lzo',
	  'gs://backup-postgres//rohit-hp/weekly/wal_005/0000000B0000000800000060.lzo',
 	  'gs://backup-postgres//rohit-hp/weekly/basebackups_005/base_0000000B000000080000005F_00000040/extended_version.txt',
	  'gs://backup-postgres//rohit-hp/weekly/basebackups_005/base_0000000B000000080000005F_00000040/tar_partitions/part_00000000.tar.lzo',
  	  'gs://backup-postgres//rohit-hp/weekly/basebackups_005/base_0000000B000000080000005F_00000040_backup_stop_sentinel.json' ]


### Get Size

	pg_backup size [--host HOST]

Get the size of backups of the current host or the specified one.

eg.

	pg_backup size
	Output: 2017-10-04T14:39:59+0530 <log> TOTAL: 1136 objects, 511297075 bytes (487.61 MiB)

### Do CRON Task

	pg_backup cron

This will do a daily backup and deletion. Will check for the day of the week, if it is 'Saturday'(default, can be changed by changing var in group_vars), then do a weekly backup(copy the last day's daily backup to weekly branch) and deletion too. On completion(success/failure), will send a slack message to the specified channel(default:'@dev-events') in settings. 

eg.

	Slack Message:
	CRON JOB REPORT for rohit-hp
	----------------
	Daily Backup: Succesfully done on Fri Sep 29 2017 15:58:56 GMT+0530 for host rohit-hp

	Weekly Backup: Copied daily backup base_0000000B00000006000000ED_00000040 to weekly, no. of files : 3

	Daily Deletion: Retained the latest 8 backups for host rohit-hp

	Weekly Deletion: Number of backups are not more than 12 for host rohit-hp

## Options

### --log, -l

	pg_backup <command> -l 

No parameters. Logging by default is done in a file in the /var/log/postgres_backup directory and console logging is off.
Console logging can be enabled by using this option. (default: false)

eg.

	pg_backup size -l
	pg_backup list -l --branch weekly

### --branch, -b
Specify branch : 'daily' or 'weekly' (default: daily)

### --host, -h
Which host's backups to query, useful if cloning through backups (default: SELF)

### --date, -d

[When with -r](#restore-from-base-backup)

Set recovery_target_time to this time in the recovery.conf. Made for PITR recovery. 
(default: NOW - will try to restore as many wal archives it can find in the branch, if in 'daily' branch will restore till latest point)

[When used with -R](#restore-from-date)
	
Will search for latest backup before or on this time/date, first in daily branch then in weekly also used as recover_target_ti
(default: NOW)

**FORMAT**: YYYY-MM-DD or YYYY-MM-DD_HH-mm

### --day, -w
The day of which the daily backup will be copied (default: 6 - Saturday) 

FORMAT: ...-2:Last Friday,-1:Last Sat, **0:Sun**, 1:Mon, 2:Tue,...

### --retain, -r
Retain the N most recent backups (default: 12)

### --base
Name of the base backup (default: LATEST - the latest backup available in the branch)

### --force, -f
No parameters. If option is used, the old PGDATA directory will be renamed to PGDATA_DATE(default: false)

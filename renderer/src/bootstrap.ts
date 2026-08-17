// ABOUTME: Strip app-level DO TLS override before pg/S3/fetch load.
delete process.env.NODE_TLS_REJECT_UNAUTHORIZED

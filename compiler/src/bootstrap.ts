delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
// local dev only; app platform injects env and dotenv never overrides what is already set
require('dotenv').config()

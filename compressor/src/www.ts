// ABOUTME: Express server setup with CORS.
// ABOUTME: Exports the app instance for route registration.

import express from 'express'
import cors from 'cors'
import * as http from 'http'

const corsSettings = {
  origin: '*',
  exposedHeaders: ['x-frames', 'x-original-format', 'x-type', 'x-output-format', 'x-error', 'Retry-After'],
}

export const app = express()
app.use(cors(corsSettings))

const port = process.env.PORT || '9473'
app.set('port', port)

const server = http.createServer(app)
server.listen(port)
server.on('error', onError)
server.on('listening', onListening)

function onError(error: any) {
  if (error.syscall !== 'listen') {
    throw error
  }
  if (error.code === 'EACCES') {
    console.error(`Port ${port} requires elevated privileges`)
    process.exit(1)
  }
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use`)
    process.exit(1)
  }
  throw error
}

function onListening() {
  console.log(`Server listening on port ${port}`)
}

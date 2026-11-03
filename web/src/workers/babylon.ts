import { versionsUrl } from '../../../common/utils'

if (typeof importScripts === 'function') {
  importScripts(process.env.NODE_ENV === 'development' ? '/vendor/library-9.25.0.min.js' : `${versionsUrl}/${process.env.BUILD_NUM}/babylon.js`)
}

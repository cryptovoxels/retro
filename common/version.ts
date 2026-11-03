import * as semver from 'semver'

export const defaultVersion = '1.0.0'

// Client releases inline their tag and date. Server build metadata is independent.
const DEFAULT_BUILD_NUM = '69420'
const DEFAULT_BUILD_DATE = '1969-4-20 04:20:69'

export const currentVersion = process.env.BUILD_NUM || DEFAULT_BUILD_NUM
export const currentBuildDate = process.env.BUILD_DATE ?? DEFAULT_BUILD_DATE

// proxy since most packages will import the constants above as well
export const deprecated = (checkVersion: string, releaseVersion: string): boolean => {
  // If they're both semver, use semver comparisons
  if (semver.valid(checkVersion) && semver.valid(releaseVersion)) {
    return semver.lt(checkVersion, releaseVersion)
  }
  if (!semver.valid(checkVersion) && semver.valid(releaseVersion)) {
    return false
  }
  if (semver.valid(checkVersion) && !semver.valid(releaseVersion)) {
    return true
  } else {
    return compareCiBuildNumbers(checkVersion, releaseVersion) < 0
  }
}

function compareCiBuildNumbers(checkVersion: string, releaseVersion: string): number {
  return parseInt(checkVersion) - parseInt(releaseVersion)
}

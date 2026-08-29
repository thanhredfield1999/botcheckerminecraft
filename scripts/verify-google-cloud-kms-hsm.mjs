import {
  executeGoogleCloudKmsLivePreflightArgs
} from '../dist/src/google-cloud-kms-live-preflight.js'

const report = await executeGoogleCloudKmsLivePreflightArgs(process.argv.slice(2))
process.stdout.write(JSON.stringify(report) + '\n')
process.exitCode = report.status === 'OBSERVED' ? 0 : 1

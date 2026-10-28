'use strict'
// Record a known upstream native-install failure as an XFAIL diagnostic.
// Unknown install failures MUST still fail the CI.
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const status=Number(process.argv[2])
const input=process.argv[3]
assert(Number.isInteger(status)&&status!==0,'must receive a failing install exit status')
assert(input,'log path required')
const log=fs.readFileSync(input,'utf8')
const known=/Cannot assign to read only property ['"]cflags['"]/i.test(log) &&
  /node-gyp/i.test(log) && /node_modules\/gl/i.test(log)
const evidenceDir=path.resolve(process.env.MBOT_PLUGIN_EVIDENCE_DIR || 'chosen-evidence')
fs.mkdirSync(evidenceDir,{recursive:true})
const report={
  plugin:'panorama',status:known?'XFAIL':'FAIL',stage:'install_native_dependencies',
  node:process.version,installExitCode:status,
  knownBlocker:known?'node-gyp 7.1.2 cannot assign read-only cflags building gl on Node 22':null,
  note:'XFAIL is a documented dependency blocker, NOT a successful panorama render. No package adopted in runtime.'
}
fs.writeFileSync(path.join(evidenceDir,'panorama.json'),JSON.stringify(report,null,2)+'\n')
console.log('INSTALL_DIAGNOSTIC',JSON.stringify(report))
assert(known,'Unexpected panorama install error; investigation required (not an approved XFAIL)')

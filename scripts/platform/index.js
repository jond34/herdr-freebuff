'use strict'

// Platform seam. Everything that differs between hosts lives in one of the two
// implementations below; the watcher only ever sees this interface. A caller
// asks what the host can do, never which host it is.
//
//   name               process.platform of the running host
//   seesOpenFiles      whether open files of another pid can be listed
//   seesProcessTable   whether another process's argv and environment can be read
//   pidAlive           liveness test for a pid
//   descendants        child pids of a pid (empty where there is no tree to walk)
//   fdTargets          open file paths of a pid
//   envOf              environment value of another process
//   argvTable          every visible pid with its argv
//   pathExtensions     suffixes to try when resolving a command on PATH
//   invocation         file and argv to run an executable, including any wrapper
//                      a host needs for script shims
//   launchArgv         argv for reopening this plugin's launcher for a chat

module.exports = process.platform === 'win32' ? require('./windows') : require('./unix')

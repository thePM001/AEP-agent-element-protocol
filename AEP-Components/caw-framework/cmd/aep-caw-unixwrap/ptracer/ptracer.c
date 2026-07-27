/*
 * libaep-caw-ptracer.so - LD_PRELOAD library for Yama ptrace_scope workaround.
 *
 * Under Yama ptrace_scope=1 (Ubuntu/Debian default), only ancestor processes
 * can use ProcessVMReadv on a target. In the aep-caw wrap path, the server is
 * NOT an ancestor of child processes (PR_SET_PTRACER doesn't inherit across
 * fork). This library runs as an LD_PRELOAD constructor in every dynamically-
 * linked child process, calling prctl(PR_SET_PTRACER, server_pid) to authorize
 * the server to read the process's memory for seccomp path resolution.
 *
 * The server PID is read from the AEP_CAW_SERVER_PID environment variable.
 *
 * Build: gcc -shared -fPIC -Os -o libaep-caw-ptracer.so ptracer.c
 */

#include <sys/prctl.h>
#include <stdlib.h>

#ifndef PR_SET_PTRACER
#define PR_SET_PTRACER 0x59616d61
#endif

__attribute__((constructor))
static void aep-caw_set_ptracer(void) {
    const char *s = getenv("AEP_CAW_SERVER_PID");
    if (s) {
        long pid = strtol(s, NULL, 10);
        if (pid > 0)
            prctl(PR_SET_PTRACER, (unsigned long)pid, 0, 0, 0);
    }
}

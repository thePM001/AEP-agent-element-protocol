//! Process 1 of every CAW sandbox.
//!
//! ```text
//! aep-caw-init [--relay <port> <socket>] -- <command> [args]
//! ```
//!
//! It does three things:
//!
//! - With `--relay` it listens on the loopback device of the sandbox and hands every
//!   connection to the Unix socket of the egress proxy. The sandbox has no other way
//!   out, so a program that ignores the proxy reaches nothing.
//! - It starts the command.
//! - It reaps every child of the sandbox and ends with the exit code of the command.
//!
//! It judges nothing. Every decision is made outside the sandbox.

use std::io::Write;
use std::net::{Ipv4Addr, Shutdown, TcpListener, TcpStream};
use std::os::unix::net::UnixStream;
use std::process::{Command, ExitCode};

use rustix::process::{wait, WaitOptions};

/// Exit code when the command cannot be started.
const EXIT_NOT_STARTED: u8 = 127;
/// Exit code of a call with wrong arguments or a relay that cannot listen.
const EXIT_USAGE: u8 = 64;

/// One parsed call.
#[derive(Debug, PartialEq, Eq)]
struct Call {
    relay: Option<(u16, String)>,
    command: Vec<String>,
}

fn parse(args: &[String]) -> Result<Call, String> {
    let (relay, rest) = match args.first().map(String::as_str) {
        Some("--relay") => {
            let port = args
                .get(1)
                .and_then(|p| p.parse::<u16>().ok())
                .filter(|p| *p != 0)
                .ok_or("--relay needs a port from 1 to 65535")?;
            let socket = args
                .get(2)
                .filter(|s| s.starts_with('/'))
                .ok_or("--relay needs the absolute path of a socket")?;
            (Some((port, socket.clone())), &args[3..])
        }
        _ => (None, args),
    };
    match rest.split_first() {
        Some((dashes, command)) if dashes == "--" && !command.is_empty() => Ok(Call {
            relay,
            command: command.to_vec(),
        }),
        _ => Err("the command must follow two dashes".to_string()),
    }
}

/// Copies both directions between one connection and the egress socket.
fn relay(client: TcpStream, socket: &str) {
    let Ok(upstream) = UnixStream::connect(socket) else {
        let _ = client.shutdown(Shutdown::Both);
        return;
    };
    let (Ok(mut client_read), Ok(mut upstream_write)) = (client.try_clone(), upstream.try_clone())
    else {
        return;
    };
    let up = std::thread::spawn(move || {
        let _ = std::io::copy(&mut client_read, &mut upstream_write);
        let _ = upstream_write.shutdown(Shutdown::Write);
    });
    let (mut upstream_read, mut client_write) = (upstream, client);
    let _ = std::io::copy(&mut upstream_read, &mut client_write);
    let _ = client_write.shutdown(Shutdown::Write);
    let _ = up.join();
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let call = match parse(&args) {
        Ok(call) => call,
        Err(message) => {
            let _ = writeln!(std::io::stderr(), "aep-caw-init: {message}");
            return ExitCode::from(EXIT_USAGE);
        }
    };
    if let Some((port, socket)) = call.relay {
        let listener = match TcpListener::bind((Ipv4Addr::LOCALHOST, port)) {
            Ok(listener) => listener,
            Err(err) => {
                let _ = writeln!(
                    std::io::stderr(),
                    "aep-caw-init: the relay cannot listen on port {port}: {err}"
                );
                return ExitCode::from(EXIT_USAGE);
            }
        };
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let socket = socket.clone();
                std::thread::spawn(move || relay(stream, &socket));
            }
        });
    }
    let child = match Command::new(&call.command[0])
        .args(&call.command[1..])
        .spawn()
    {
        Ok(child) => child,
        Err(err) => {
            let _ = writeln!(
                std::io::stderr(),
                "aep-caw-init: {}: {err}",
                call.command[0]
            );
            return ExitCode::from(EXIT_NOT_STARTED);
        }
    };
    let command_pid = i32::try_from(child.id()).unwrap_or(0);
    // Process 1 inherits every orphan of the sandbox. Waiting for any child reaps
    // them all. The loop ends when the command itself is done.
    loop {
        match wait(WaitOptions::empty()) {
            Ok(Some((pid, status))) if pid.as_raw_nonzero().get() == command_pid => {
                let code = status
                    .exit_status()
                    .or_else(|| status.terminating_signal().map(|signal| 128 + signal))
                    .unwrap_or(1);
                return ExitCode::from(u8::try_from(code.clamp(0, 255)).unwrap_or(1));
            }
            Ok(_) => {}
            Err(_) => return ExitCode::from(1),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(text: &str) -> Vec<String> {
        text.split_whitespace().map(str::to_string).collect()
    }

    #[test]
    fn a_call_with_and_without_the_relay_parses() {
        assert_eq!(
            parse(&args("-- sh -c true")),
            Ok(Call {
                relay: None,
                command: args("sh -c true"),
            })
        );
        assert_eq!(
            parse(&args("--relay 3128 /run/caw/egress.sock -- curl --relay x")),
            Ok(Call {
                relay: Some((3128, "/run/caw/egress.sock".to_string())),
                command: args("curl --relay x"),
            })
        );
    }

    #[test]
    fn wrong_calls_are_refused() {
        for text in [
            "",
            "--",
            "sh -c true",
            "--relay",
            "--relay 0 /s -- sh",
            "--relay 70000 /s -- sh",
            "--relay 3128 relative.sock -- sh",
            "--relay 3128 /s sh",
            "--relay 3128 /s --",
        ] {
            assert!(parse(&args(text)).is_err(), "{text:?}");
        }
    }

    #[test]
    fn the_relay_carries_both_directions() {
        use std::io::Read;
        let dir = std::env::temp_dir().join(format!("caw-init-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp dir");
        let socket = dir.join("egress.sock");
        let upstream = std::os::unix::net::UnixListener::bind(&socket).expect("bind");
        let server = std::thread::spawn(move || {
            let (mut stream, _) = upstream.accept().expect("accept");
            let mut seen = Vec::new();
            stream.read_to_end(&mut seen).expect("read");
            stream.write_all(b"reply:").expect("write");
            stream.write_all(&seen).expect("write");
        });
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("listen");
        let address = listener.local_addr().expect("address");
        let path = socket.to_string_lossy().into_owned();
        let relayed = std::thread::spawn(move || {
            let (stream, _) = listener.accept().expect("accept");
            relay(stream, &path);
        });
        let mut client = TcpStream::connect(address).expect("connect");
        client.write_all(b"hello").expect("write");
        client.shutdown(Shutdown::Write).expect("shutdown");
        let mut reply = String::new();
        client.read_to_string(&mut reply).expect("read");
        assert_eq!(reply, "reply:hello");
        server.join().expect("server");
        relayed.join().expect("relay");
        let _ = std::fs::remove_dir_all(dir);
    }
}

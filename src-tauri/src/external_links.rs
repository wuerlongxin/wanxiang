use std::process::Command;

use crate::error::CommandError;

pub const PROJECT_REPOSITORY_URL: &str = "https://github.com/suifei/wanxiang-deck";

#[derive(Debug, PartialEq)]
struct LaunchSpec {
    program: &'static str,
    args: Vec<&'static str>,
}

fn repository_launch_spec() -> Result<LaunchSpec, CommandError> {
    #[cfg(target_os = "macos")]
    {
        return Ok(LaunchSpec {
            program: "open",
            args: vec![PROJECT_REPOSITORY_URL],
        });
    }

    #[cfg(target_os = "windows")]
    {
        return Ok(LaunchSpec {
            program: "rundll32.exe",
            args: vec!["url.dll,FileProtocolHandler", PROJECT_REPOSITORY_URL],
        });
    }

    #[cfg(target_os = "linux")]
    {
        return Ok(LaunchSpec {
            program: "xdg-open",
            args: vec![PROJECT_REPOSITORY_URL],
        });
    }

    #[allow(unreachable_code)]
    Err(CommandError::new(
        "EXTERNAL_LINK_UNSUPPORTED",
        "当前系统不支持打开项目仓库。",
    ))
}

#[tauri::command]
pub fn open_project_repository() -> Result<(), CommandError> {
    let spec = repository_launch_spec()?;
    Command::new(spec.program)
        .args(spec.args)
        .spawn()
        .map(|_| ())
        .map_err(|_| {
            CommandError::new(
                "EXTERNAL_LINK_OPEN_FAILED",
                "无法调用系统浏览器打开项目仓库。",
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repository_url_is_the_canonical_https_address() {
        let parsed = url::Url::parse(PROJECT_REPOSITORY_URL).expect("repository URL should parse");
        assert_eq!(parsed.scheme(), "https");
        assert_eq!(parsed.host_str(), Some("github.com"));
        assert_eq!(parsed.path(), "/suifei/wanxiang-deck");
        assert!(parsed.query().is_none());
        assert!(parsed.fragment().is_none());
    }

    #[test]
    fn platform_launcher_receives_the_repository_as_one_argument() {
        let spec = repository_launch_spec().expect("desktop launcher should exist");
        assert!(spec.args.contains(&PROJECT_REPOSITORY_URL));
        assert_eq!(
            spec.args
                .iter()
                .filter(|argument| **argument == PROJECT_REPOSITORY_URL)
                .count(),
            1
        );
    }
}

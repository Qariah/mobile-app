# Security Policy

## Supported versions

We accept security reports for the latest released version of the Qariah app (`com.qariah.app`) on
the App Store and Google Play.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report privately through one of these channels:

1. **GitHub private security advisory (preferred):** open a private advisory from the **Security**
   tab of this repository.
2. **Email:** send details to **info@qariah.org** with "security" in the subject.

We will acknowledge your report within **72 hours** and aim to ship a fix within **14 days** for
confirmed critical issues. Because this repository is a published mirror, fixes are developed in a
private workspace (and, where the issue is in shared code, upstream in
[Bayaan](https://github.com/thebayaan/Bayaan)) and reach users through a normal store update.

## What to include

- A clear description of the vulnerability and its potential impact
- Steps to reproduce
- A suggested fix, if you have one

## What qualifies as a security issue

Report privately if the issue involves:

- Exposure of user data (favorites, notes, bookmarks, playlists, account tokens)
- Authentication or authorization bypass (including Quran Foundation OAuth handling)
- Malicious media handling leading to code execution
- Credential, token, or storage-origin exposure
- Deep-link hijacking or file-path traversal

## What does not need a private report

Open a regular GitHub issue for app crashes, playback bugs, UI/UX problems, and performance issues.

## Acknowledgements

We appreciate responsible disclosure. If your report leads to a fix, we will credit you in the
release notes unless you prefer to remain anonymous.

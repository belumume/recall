// Talking to GitHub. Everything the app knows lives in one private repo of
// yours: the cards and settings as files, and every grade as a comment on
// that day's "Reviews due" issue. The app reaches it with a key (a
// fine-grained token) that only this phone keeps.

const API = "https://api.github.com";

export class GitHub {
  constructor(token, repo) {
    this.token = token;
    this.repo = repo; // "owner/name"
  }

  async call(path, { method = "GET", body, raw = false } = {}) {
    const res = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    if (!res.ok) {
      const err = new Error(`GitHub said ${res.status} for ${method} ${path}`);
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return null;
    return raw ? res.text() : res.json();
  }

  // Every page of a list (GitHub sends at most 100 at a time).
  async all(path) {
    const out = [];
    let url = `${API}${path}${path.includes("?") ? "&" : "?"}per_page=100`;
    while (url) {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28" },
        cache: "no-store",
      });
      if (!res.ok) {
        const err = new Error(`GitHub said ${res.status} for ${path}`);
        err.status = res.status;
        throw err;
      }
      out.push(...(await res.json()));
      const next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") || "");
      url = next ? next[1] : null;
    }
    return out;
  }

  file(path) {
    return this.call(`/repos/${this.repo}/contents/${path}`, { raw: true });
  }

  async fileOrNull(path) {
    try { return await this.file(path); } catch (e) { if (e.status === 404) return null; throw e; }
  }

  reviewIssues(since) {
    return this.all(`/repos/${this.repo}/issues?labels=reviews&state=all&since=${since}`)
      .then((list) => list.filter((i) => !i.pull_request));
  }

  comments(number) {
    return this.all(`/repos/${this.repo}/issues/${number}/comments`);
  }

  comment(number, body) {
    return this.call(`/repos/${this.repo}/issues/${number}/comments`, { method: "POST", body: { body } });
  }

  openIssue(title, body, assignee) {
    return this.call(`/repos/${this.repo}/issues`, { method: "POST",
      body: { title, body, labels: ["reviews"], assignees: assignee ? [assignee] : [] } });
  }

  closeIssue(number) {
    return this.call(`/repos/${this.repo}/issues/${number}`, { method: "PATCH",
      body: { state: "closed", state_reason: "completed" } });
  }
}

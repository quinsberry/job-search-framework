"""LinkedIn public URL adapter. No credentials, browser, or JavaScript runtime."""

from html.parser import HTMLParser
import re
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin, urlsplit
from urllib.request import Request, urlopen

from evaluate import ValidationError, canonical_url


class Node:
    def __init__(self, tag="", attrs=()):
        self.tag, self.attrs, self.children = tag, dict(attrs), []

    def find(self, predicate):
        found = [self] if predicate(self) else []
        for child in self.children:
            if isinstance(child, Node):
                found.extend(child.find(predicate))
        return found

    def has_class(self, value):
        return value in (self.attrs.get("class") or "").split()

    def content(self):
        if self.tag in {"script", "style"}:
            return ""
        parts = [child.content() if isinstance(child, Node) else child for child in self.children]
        return "".join(parts) + ("\n" if self.tag in {"br", "p", "div", "li", "h1", "h2", "h3", "h4", "tr"} else "")

    def plain(self):
        return "\n".join(line.strip() for line in self.content().splitlines() if line.strip())


class Document(HTMLParser):
    def __init__(self, body):
        super().__init__(convert_charrefs=True)
        self.root = Node()
        self.stack = [self.root]
        self.feed(body)

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs)
        self.stack[-1].children.append(node)
        if tag not in {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.stack[-1].children.append(Node(tag, attrs))

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                break

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def first(root, classes):
    for name in classes:
        nodes = root.find(lambda n: n.has_class(name))
        if nodes:
            return nodes[0]
    return None


def cards(body):
    root = Document(body).root
    output = []
    for card in root.find(lambda n: (n.attrs.get("data-entity-urn") or "").startswith("urn:li:jobPosting:")):
        title = first(card, ["base-search-card__title", "sr-only"])
        link = first(card, ["base-card__full-link"])
        if not title or not link or not link.attrs.get("href"):
            continue
        company = first(card, ["base-search-card__subtitle"])
        location = first(card, ["job-search-card__location"])
        dates = card.find(lambda n: n.tag == "time" and bool(n.attrs.get("datetime")))
        url = canonical_url(urljoin("https://www.linkedin.com", link.attrs["href"]))
        output.append({"source": "linkedin", "source_id": card.attrs["data-entity-urn"].split(":")[-1],
                       "url": url, "title": title.plain(), "company": company.plain() if company else None,
                       "location": location.plain() if location else None,
                       "posted_at": dates[0].attrs["datetime"] if dates else None})
    if not output and body.strip() and not any(message in root.plain().casefold() for message in ("no matching jobs", "no results found", "no jobs found")):
        raise ValidationError("LinkedIn returned unrecognized search markup")
    return output


def details(candidate, body):
    root = Document(body).root
    out = dict(candidate)
    for key, classes in {
        "title": ["topcard__title", "top-card-layout__title"],
        "company": ["topcard__org-name-link"],
        "location": ["topcard__flavor--bullet"],
        "description": ["show-more-less-html__markup", "description__text"],
    }.items():
        node = first(root, classes)
        if node and node.plain():
            out[key] = node.plain()
    labels = {"seniority level": "seniority_label", "employment type": "employment_type"}
    for item in root.find(lambda n: n.has_class("description__job-criteria-item")):
        label = first(item, ["description__job-criteria-subheader"])
        value = first(item, ["description__job-criteria-text"])
        if label and value and label.plain().casefold() in labels:
            out[labels[label.plain().casefold()]] = value.plain()
    # A missing closure banner does not establish that a posting remains active.
    closure = re.search(r"no longer accepting applications", root.plain(), re.IGNORECASE)
    out["active"] = False if closure else None
    if closure:
        out["closure_evidence"] = {"kind": "closed_banner", "quote": closure.group(0)}
    apply = root.find(lambda n: n.attrs.get("id") == "topbar-apply" and bool(n.attrs.get("href")))
    if apply:
        href = urljoin(candidate["url"], apply[0].attrs["href"])
        host = urlsplit(href).hostname or ""
        if host != "linkedin.com" and not host.endswith(".linkedin.com"):
            out["application_url"] = canonical_url(href)
    out["fetch_status"] = "ok" if out.get("description") else "missing_description"
    out.setdefault("facts", {})
    return out


class LinkedIn:
    """Adapter contract: queries(criteria), page(query, offset), detail(candidate)."""

    page_size = 10

    def __init__(self, delay=2.0):
        self.delay = delay
        self.last_request = None

    def fetch(self, url):
        host = urlsplit(url).hostname or ""
        if host != "linkedin.com" and not host.endswith(".linkedin.com"):
            raise ValidationError("LinkedIn adapter refuses a non-LinkedIn URL")
        for attempt in range(3):
            if self.last_request is not None:
                time.sleep(max(0, self.delay - (time.monotonic() - self.last_request)))
            self.last_request = time.monotonic()
            try:
                request = Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "text/html"})
                with urlopen(request, timeout=15) as response:
                    body = response.read().decode("utf-8", errors="replace")
                    redirect = response.geturl().casefold()
                if any(signal in redirect for signal in ("/authwall", "/login", "/checkpoint")) or (len(body) < 2000 and "authwall" in body.casefold()):
                    raise ValidationError("LinkedIn returned an authentication wall")
                return body
            except HTTPError as exc:
                if exc.code == 404:
                    return None
                if exc.code not in {429, 500, 502, 503, 504}:
                    raise ValidationError(f"LinkedIn HTTP {exc.code}") from None
                error = f"LinkedIn HTTP {exc.code}"
            except (URLError, TimeoutError, OSError) as exc:
                error = f"LinkedIn transport failure: {exc}"
            if attempt < 2:
                time.sleep(2 ** attempt)
        raise ValidationError(error)

    def queries(self, c):
        # LinkedIn guest search requires geographic places even for remote work.
        places = list(dict.fromkeys([c["candidate"]["country"]] + (c["office_locations"] or [])))
        arrangements = c["work_arrangements"] or [None]
        return [{"keywords": title, "location": place, "work_arrangement": arrangement,
                 "posting_age_days": c["posting_age_days"]}
                for title in c["titles"] for place in places for arrangement in arrangements]

    def page(self, query, offset):
        params = {"keywords": query["keywords"], "location": query["location"], "start": offset}
        if query["work_arrangement"]:
            params["f_WT"] = {"onsite": 1, "remote": 2, "hybrid": 3}[query["work_arrangement"]]
        if query["posting_age_days"]:
            params["f_TPR"] = f"r{query['posting_age_days'] * 86400}"
        body = self.fetch("https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?" + urlencode(params))
        return cards(body) if body else []

    def detail(self, candidate):
        body = self.fetch(candidate["url"])
        if body is None:
            return {**candidate, "fetch_status": "not_found", "active": None, "availability_reason": "http_404", "facts": {}}
        return details(candidate, body)

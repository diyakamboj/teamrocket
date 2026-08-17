import pytest
from app.services.profile_enrichment_service import profile_enrichment_service


@pytest.mark.asyncio
async def test_extract_links_from_text():
    text = """
    Software Engineer
    GitHub: https://github.com/octocat
    LinkedIn: https://linkedin.com/in/octocat
    HackerRank: https://hackerrank.com/octocat
    Portfolio: https://octocat.dev
    """
    links = profile_enrichment_service.extract_links(resume_text=text)
    platforms = [l.platform for l in links]

    assert "github" in platforms
    assert "linkedin" in platforms
    assert "hackerrank" in platforms


@pytest.mark.asyncio
async def test_enrich_candidate_profile_with_github(monkeypatch):
    async def mock_fetch_github(username):
        return {
            "status": "active",
            "bio": "Open source maintainer",
            "public_repos": 12,
            "followers": 45,
            "languages": ["Python", "TypeScript"],
            "repositories": [
                {"name": "fast-api-demo", "stars": 15, "language": "Python", "url": "https://github.com/octocat/fast-api-demo", "origin": "github"}
            ],
        }

    monkeypatch.setattr(profile_enrichment_service, "fetch_github_profile", mock_fetch_github)

    profile = await profile_enrichment_service.enrich_candidate_profile(
        github_url="https://github.com/octocat",
        linkedin_url="https://linkedin.com/in/octocat",
    )

    assert len(profile.external_links) == 2
    assert len(profile.repositories) == 1
    assert profile.repositories[0].name == "fast-api-demo"
    assert "Python" in [s.name for s in profile.inferred_skills]
    assert profile.summary is not None


@pytest.mark.asyncio
async def test_enrich_candidate_without_links_returns_empty_profile():
    profile = await profile_enrichment_service.enrich_candidate_profile(resume_text="No links here")
    assert profile.external_links == []
    assert profile.repositories == []
    assert "No external profiles" in profile.summary

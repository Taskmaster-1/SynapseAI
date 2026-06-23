import composio.client.enums.app as composio_app

_original_fetch_and_cache = composio_app.App.fetch_and_cache

def patched_fetch_and_cache(self):
    try:
        return _original_fetch_and_cache(self)
    except KeyError as e:
        if str(e) == "'name'":
            from composio.client import Composio
            client = Composio.get_latest()
            response = client.http.get(url=str(client.apps.endpoint / self.slug)).json()
            if "message" in response:
                return None
            return composio_app.AppData(
                name=response.get("name", response.get("appName", self.slug.upper())),
                path=self.storage_path,
                is_local=False,
            )
        raise e

def apply_patch():
    composio_app.App.fetch_and_cache = patched_fetch_and_cache

import unittest

from fastapi import HTTPException
from pydantic import SecretStr

from app.config import Settings
from app.database import get_db_session


class DatabaseConfigurationTests(unittest.TestCase):
    def test_missing_database_url_returns_service_unavailable(self) -> None:
        settings = Settings(database_url=SecretStr(""), _env_file=None)
        session_generator = get_db_session(settings)

        with self.assertRaises(HTTPException) as raised:
            next(session_generator)

        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(raised.exception.detail, "Database access is not configured")


if __name__ == "__main__":
    unittest.main()

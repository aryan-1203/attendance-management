"""SMTP email. When SMTP host is not configured (dev), messages are written to storage/outbox and logged."""
import logging
import smtplib
from email.message import EmailMessage
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.base import utcnow
from app.services import policy_service

log = logging.getLogger("prosparity.email")


def send(db: Session, to: list[str], subject: str, body: str,
         attachments: list[tuple[str, bytes, str]] | None = None) -> dict:
    cfg = policy_service.get_all(db)
    msg = EmailMessage()
    msg["From"] = cfg.get("smtp_from") or "prosparity@example.com"
    msg["To"] = ", ".join(to)
    msg["Subject"] = subject
    msg.set_content(body)
    for name, data, mime in attachments or []:
        maintype, subtype = mime.split("/", 1)
        msg.add_attachment(data, maintype=maintype, subtype=subtype, filename=name)

    host = (cfg.get("smtp_host") or "").strip()
    if not host or settings.environment == "test":
        outbox = Path(settings.report_dir).parent / "outbox"
        outbox.mkdir(parents=True, exist_ok=True)
        path = outbox / f"{utcnow():%Y%m%d-%H%M%S-%f}.eml"
        path.write_bytes(bytes(msg))
        log.info("[dev email] to=%s subject=%r saved=%s", to, subject, path)
        return {"mode": "logged", "path": str(path)}
    with smtplib.SMTP(host, int(cfg.get("smtp_port") or 587), timeout=20) as smtp:
        if cfg.get("smtp_use_tls"):
            smtp.starttls()
        if cfg.get("smtp_username"):
            smtp.login(cfg["smtp_username"], cfg.get("smtp_password") or "")
        smtp.send_message(msg)
    return {"mode": "smtp"}

"""HTML email reports for ProcessIQ classifications."""

from __future__ import annotations

import html
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Sequence

from processiq_classifier import ClassificationResult
from processiq_config import Settings
from processiq_core import PASS_THRESHOLD


def render_html_report(results: Sequence[ClassificationResult]) -> str:
    cards = []
    for item in results:
        scores = "".join(
            f"<td><strong>L{level}</strong><br>{score:.0f}%</td>"
            for level, score in item.scores.items()
        )
        actions = "".join(f"<li>{html.escape(action)}</li>" for action in item.actions[:6]) or "<li>None</li>"
        cards.append(
            f"""
            <section style="border:1px solid #d9e2ec;border-radius:12px;padding:20px;margin:0 0 20px;background:#fff;">
              <h2 style="margin:0 0 8px;color:#102a43;">{html.escape(item.process_name)}</h2>
              <p style="margin:0 0 12px;color:#243b53;">
                Level {item.level} — <strong>{html.escape(item.label)}</strong>
              </p>
              <table style="width:100%;border-collapse:collapse;margin:0 0 12px;text-align:center;color:#334e68;">
                <tr>{scores}</tr>
              </table>
              <p style="color:#334e68;">{html.escape(item.narrative)}</p>
              <p style="color:#627d98;font-size:13px;">Pass mark {PASS_THRESHOLD:.0f}% with sequential gates.</p>
              <h3 style="color:#102a43;">Next actions</h3>
              <ul>{actions}</ul>
            </section>
            """
        )
    return f"""
    <html>
      <body style="margin:0;padding:24px;background:#f0f4f8;font-family:Arial,sans-serif;">
        <h1 style="color:#102a43;">ProcessIQ maturity report</h1>
        <p style="color:#334e68;">Official rules scoring plus narrative. The model does not invent the level.</p>
        {''.join(cards)}
      </body>
    </html>
    """


def send_report(settings: Settings, results: Sequence[ClassificationResult]) -> str:
    if not results:
        raise ValueError("No classification results to send")
    if not settings.smtp_ready():
        raise ValueError("SMTP_HOST, SMTP_FROM, and SMTP_TO are required")
    subject_name = results[0].process_name if len(results) == 1 else f"{len(results)} processes"
    subject = f"ProcessIQ: {subject_name} — Level {results[0].level} {results[0].label}"
    html_body = render_html_report(results)
    text_body = "\n\n".join(
        f"{item.process_name}: Level {item.level} {item.label}\n{item.narrative}"
        for item in results
    )
    message = MIMEMultipart("alternative")
    message["Subject"] = subject
    message["From"] = settings.smtp_from
    message["To"] = ", ".join(settings.recipients())
    message.attach(MIMEText(text_body, "plain", "utf-8"))
    message.attach(MIMEText(html_body, "html", "utf-8"))

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port_int(), timeout=30) as smtp:
        smtp.ehlo()
        try:
            smtp.starttls()
        except smtplib.SMTPException:
            pass
        if settings.smtp_user:
            smtp.login(settings.smtp_user, settings.smtp_password)
        smtp.sendmail(settings.smtp_from, settings.recipients(), message.as_string())
    return f"Sent HTML report to {', '.join(settings.recipients())}"

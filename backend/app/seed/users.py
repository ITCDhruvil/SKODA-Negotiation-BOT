"""The user list of the AIS prototype (Increment 11, QA pass): one demo persona per role and entity.

Rebuilt from the prototype's own seed rules (role list, persona table, cost centres) so that the people
offered when someone asks for an event are the same ones the prototype knows. There are no real names:
each persona is "<Role> Persona <Entity>".
"""
from __future__ import annotations

ROLES = (
    ("INITIATOR", "Initiator"), ("CC_HEAD", "CC Head"), ("DEPT_HEAD", "Dept Head"), ("BUYER", "Buyer"),
    ("SECTION_HEAD_BA", "Section Head BA"), ("HEAD_BA", "Head BA"), ("ED_PROC", "ED Procurement"), ("MD", "MD"),
    ("FSK_COORD", "FSK Coordinator"), ("CONTROLLING", "Controlling"), ("INFOSEC", "InfoSec"),
    ("BUYER_SUPERVISOR", "Buyer Supervisor"), ("ADMIN", "Admin"), ("SUPPORT", "Support"), ("AUDITOR", "Auditor"),
)
# role, cost centre key (the prototype's persona table)
_PERSONAS = (
    ("INITIATOR", "REQ"), ("CC_HEAD", "REQ"), ("DEPT_HEAD", "REQ"), ("BUYER", "BA"), ("SECTION_HEAD_BA", "BA"),
    ("HEAD_BA", "BA"), ("ED_PROC", "MGMT"), ("MD", "MGMT"), ("FSK_COORD", "BA"), ("CONTROLLING", "CTRL"),
    ("INFOSEC", "IT"), ("BUYER_SUPERVISOR", "BA"), ("ADMIN", "PLAT"), ("SUPPORT", "PLAT"), ("AUDITOR", "AUD"),
)
ENTITIES = ("E1", "E2")
_NAME = dict(ROLES)


def _slug(role: str) -> str:
    return role.lower().replace("_", "")


def _cost_centre(entity: str, key: str) -> str:
    return "2176000" if entity == "E1" and key == "REQ" else f"DEMO-{entity}-{key}"


def build_users() -> list[dict]:
    out: list[dict] = []
    for entity in ENTITIES:
        rows = [p for p in _PERSONAS if not (entity == "E2" and p[0] == "FSK_COORD")]
        for i, (role, cc) in enumerate(rows):
            sso = f"persona.{_slug(role)}.{entity.lower()}"
            out.append({
                "id": f"user-{entity}-{role}", "entity": entity, "sso": sso, "emp_no": f"P-{entity}-{i + 1:03d}",
                "full_name": f"{_NAME[role]} Persona {entity}", "email": f"{sso}@demo.invalid", "role": role,
                "role_name": _NAME[role], "cost_centre": _cost_centre(entity, cc),
            })
    out.append({
        "id": "user-E1-UNMAPPED", "entity": "E1", "sso": "persona.unmapped.e1", "emp_no": "P-E1-016",
        "full_name": "Unmapped Persona E1", "email": "persona.unmapped.e1@demo.invalid", "role": "UNMAPPED",
        "role_name": "Unmapped", "cost_centre": "2176000",
    })
    out.append({
        "id": "user-E1-BUYER2", "entity": "E1", "sso": "persona.buyer2.e1", "emp_no": "P-E1-017",
        "full_name": "Buyer 2 Persona E1", "email": "persona.buyer2.e1@demo.invalid", "role": "BUYER",
        "role_name": "Buyer", "cost_centre": _cost_centre("E1", "BA"),
    })
    return out

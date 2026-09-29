from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Template:
    description: str
    unit: str
    qty_lo: int
    qty_hi: int
    price_lo: int
    price_hi: int


@dataclass(frozen=True)
class BuyCategory:
    code: str
    name: str
    short: str
    kind: str
    templates: tuple[Template, ...]

    @property
    def eclass(self) -> str:
        return f"{self.code} - {self.name}"


BUY_CATEGORIES = (
    BuyCategory("25200000", "Gastronomie Und Bewirtung (Dienstleistung)", "A05", "service", (
        Template("Meals For Training Batch", "EA", 40, 200, 180, 320),
        Template("Tea And Snacks For Review Meeting", "EA", 20, 120, 45, 110),
        Template("Working Lunch Boxes", "EA", 30, 150, 150, 260),
        Template("Delegation Lunch Buffet", "EA", 100, 400, 250, 310),
    )),
    BuyCategory("41120214", "Eventcatering", "G09", "service", (
        Template("Client Dinner Catering", "AU", 1, 1, 25000, 80000),
        Template("Annual Day Event Catering", "EA", 150, 400, 300, 520),
        Template("Guest Refreshment Counter Setup", "AU", 1, 2, 8000, 20000),
    )),
    BuyCategory("24321900", "Projektor", "GPN", "goods", (
        Template("Portable Projector Full HD", "EA", 1, 4, 28000, 45000),
        Template("Tripod Stand Projector Screen 10x8 Ft", "EA", 1, 4, 9000, 16000),
        Template("Wireless Presenter Clicker", "EA", 2, 10, 1800, 3500),
    )),
    BuyCategory("43211500", "IT Accessories", "GPN", "goods", (
        Template("Wireless Keyboard Mouse Combo", "EA", 10, 40, 900, 2200),
        Template("USB C Docking Station", "EA", 5, 25, 3500, 7500),
        Template("HDMI Cable 3 Mtr", "EA", 20, 100, 150, 420),
    )),
    BuyCategory("44121600", "Stationery", "A05", "goods", (
        Template("A4 Copier Paper 75 GSM Ream", "EA", 100, 600, 215, 290),
        Template("Whiteboard Markers Box", "EA", 20, 100, 180, 320),
        Template("File Folders", "EA", 100, 500, 25, 60),
    )),
    BuyCategory("90101500", "Facility Services", "G09", "service", (
        Template("Housekeeping Service Monthly", "AU", 1, 3, 45000, 90000),
        Template("Pest Control Annual Contract", "AU", 1, 1, 30000, 70000),
        Template("Garden Maintenance Monthly", "AU", 1, 3, 18000, 40000),
    )),
    BuyCategory("82121500", "Printing Services", "A05", "service", (
        Template("Visitor Brochure Printing", "EA", 500, 3000, 18, 60),
        Template("Safety Poster Printing A2", "EA", 50, 300, 90, 240),
        Template("Employee Handbook Printing", "EA", 100, 600, 120, 300),
    )),
    BuyCategory("78101800", "Transport And Logistics", "G07", "service", (
        Template("Employee Shuttle Hire Monthly", "AU", 1, 3, 40000, 85000),
        Template("Courier Charges Bulk Dispatch", "AU", 1, 2, 12000, 35000),
        Template("Visitor Cab Hire Package", "AU", 1, 4, 6000, 18000),
    )),
    BuyCategory("86101700", "Training Services", "G05", "service", (
        Template("Soft Skills Workshop Per Batch", "AU", 1, 3, 25000, 60000),
        Template("Excel Advanced Training Per Batch", "AU", 1, 3, 18000, 45000),
        Template("First Aid Training Per Batch", "AU", 1, 3, 12000, 30000),
    )),
    BuyCategory("40101800", "Maintenance Consumables", "G03", "goods", (
        Template("Lubricant Grease 18 Kg Pail", "EA", 4, 20, 3800, 6200),
        Template("Cotton Waste Bale", "EA", 20, 120, 600, 1100),
        Template("Safety Gloves Pairs", "EA", 100, 400, 45, 120),
    )),
)


@dataclass(frozen=True)
class ScrapMaterial:
    family: str
    description: str
    price_lo: int  # illustrative INR/kg (A10)
    price_hi: int


SCRAP_MATERIALS = (
    ScrapMaterial("aluminium", "Aluminium Turnings", 152, 168),
    ScrapMaterial("aluminium", "Aluminium Extrusion Scrap", 172, 190),
    ScrapMaterial("aluminium", "Aluminium Cast Scrap", 156, 174),
    ScrapMaterial("copper", "Copper Bare Bright", 720, 780),
    ScrapMaterial("copper", "Copper Mixed Scrap", 650, 700),
    ScrapMaterial("brass", "Brass Scrap", 400, 480),
    ScrapMaterial("steel", "MS HMS Scrap", 28, 38),
    ScrapMaterial("steel", "Steel Turnings", 22, 30),
    ScrapMaterial("stainless", "Stainless Steel 304 Scrap", 80, 110),
    ScrapMaterial("cast_iron", "Cast Iron Scrap", 25, 32),
    ScrapMaterial("plastic", "PP Plastic Scrap", 30, 40),
    ScrapMaterial("plastic", "PVC Scrap", 18, 26),
    ScrapMaterial("plastic", "Mixed Plastic Scrap", 12, 22),
    ScrapMaterial("ewaste", "E-Waste Mixed", 40, 90),
    ScrapMaterial("oil", "Used Oil Drums", 22, 38),
    ScrapMaterial("paper", "Cardboard And Paper Scrap", 9, 14),
    ScrapMaterial("wood", "Wooden Pallet Scrap", 5, 9),
    ScrapMaterial("rubber", "Rubber Scrap", 8, 15),
)

FAMILIES = ("aluminium", "copper", "brass", "steel", "stainless", "cast_iron", "plastic",
            "ewaste", "oil", "paper", "wood", "rubber")
FAMILY_TITLES = {
    "aluminium": "Aluminium", "copper": "Copper", "brass": "Brass", "steel": "Steel",
    "stainless": "Stainless Steel", "cast_iron": "Cast Iron", "plastic": "Plastics",
    "ewaste": "E-Waste", "oil": "Used Oil", "paper": "Paper And Cardboard",
    "wood": "Wood", "rubber": "Rubber",
}

REQUESTORS = (
    "MRUNAL PAWAR", "SHALINI RAJENDRA", "SAGAR SATHE", "NEHA KULKARNI", "AMIT DESHMUKH",
    "PRIYA JOSHI", "RAHUL PATIL", "SNEHA BHOSALE", "VIKRAM MORE", "KAVITA GAIKWAD",
    "ROHAN SHINDE", "ANJALI KADAM",
)
SCRAP_REQUESTORS = ("YARD COORDINATOR", "STORES HEAD", "EHS OFFICER", "MAINTENANCE LEAD")

"""Everyday questions in a negotiation: delivery, payment, quantity, warranty, validity, incoterm.

Either side can ask. Answers are built from the real quote and item data, in the conversation's
language, so nothing is invented. Numbers used here (days, months, quantity) come from the quote
and the item; none of them is an internal position.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

from app import deal

TOPICS = ("delivery", "payment", "quantity", "warranty", "validity", "incoterm")

# Keywords per topic in English, Hindi and Marathi. Matched on the lower-cased text.
_KEYWORDS: dict[str, list[str]] = {
    "delivery": [r"deliver", r"lead\s*time", r"pick-?up", r"lift", r"dispatch", r"schedule", r"how\s+soon",
                 r"when\s+can", r"डिलीवरी", r"डिलिव्हरी", r"कब तक", r"उठा", r"उचल", r"कधी"],
    "payment": [r"payment", r"pay\b", r"credit", r"advance", r"भुगतान", r"पेमेंट", r"उधार", r"क्रेडिट"],
    "quantity": [r"quantit", r"how\s+many", r"\bqty\b", r"volume", r"मात्रा", r"कितना", r"प्रमाण", r"किती"],
    "warranty": [r"warrant", r"guarantee", r"वारंटी", r"वॉरंटी", r"गारंटी", r"हमी"],
    "validity": [r"valid", r"expire", r"how\s+long\s+is", r"वैध", r"मान्य\s+रह", r"मुदत"],
    "incoterm": [r"incoterm", r"freight", r"transport", r"ex-?works", r"\bfob\b", r"\bcif\b", r"\bexw\b",
                 r"ढुलाई", r"भाड़ा", r"वाहतूक", r"भाडे"],
}


def topics_in(text: str, *, include_payment: bool = True) -> list[str]:
    """Topics a piece of text asks about (only counted in sentences that are questions)."""
    found: list[str] = []
    for sentence in re.split(r"(?<=[?।.!])\s+", text.lower()):
        if "?" not in sentence and "कृपया" not in sentence and "बताएं" not in sentence and "सांगा" not in sentence:
            continue
        for topic, patterns in _KEYWORDS.items():
            if topic == "payment" and not include_payment:
                continue
            if topic not in found and any(re.search(p, sentence) for p in patterns):
                found.append(topic)
    return found


@dataclass(frozen=True)
class Facts:
    direction: str  # of the event: buy = we purchase, sell = we sell scrap
    lang: str
    qty: float
    unit_word: str
    item_delivery_days: int  # what we need (buy) or how soon the lot is ready (sell)
    bid_delivery_days: int  # what the vendor quoted
    incoterm: str
    payment_code: str  # the payment term currently on the table
    validity_days: int
    warranty_months: int


def numbers(f: Facts) -> list[float]:
    """The figures the answers may quote, so the outgoing-text number check can allow them."""
    return [f.qty, f.item_delivery_days, f.bid_delivery_days, f.validity_days, f.warranty_months,
            deal.payment_days(f.payment_code)]


def _qty(x: float) -> str:
    return f"{int(x):,}" if x == int(x) else f"{x:,.2f}"


def _pay(lang: str, code: str) -> str:
    days = deal.payment_days(code)
    if days == 0:
        return {"en": "advance payment", "hi": "अग्रिम भुगतान", "mr": "आगाऊ पेमेंट"}[lang]
    return {"en": f"{days} days", "hi": f"{days} दिन", "mr": f"{days} दिवस"}[lang]


_QUOTE = {"buy": {"en": "quote", "hi": "कोटेशन", "mr": "कोटेशन"}, "sell": {"en": "bid", "hi": "बोली", "mr": "बोली"}}

# How the vendor answers a question about its own offer. {q} is "quote" or "bid" in the language.
_VENDOR: dict[tuple[str, str], dict[str, str]] = {
    ("delivery", "buy"): {
        "en": "Delivery will be within {bd} days of the order, on {inco} terms.",
        "hi": "आर्डर के बाद {bd} दिन के भीतर डिलीवरी हो जाएगी, {inco} शर्तों पर।",
        "mr": "ऑर्डर नंतर {bd} दिवसांत डिलिव्हरी होईल, {inco} अटींवर."},
    ("delivery", "sell"): {
        "en": "We can lift the material within {bd} days of your confirmation, on {inco} terms.",
        "hi": "आपकी पुष्टि के {bd} दिन के भीतर हम माल उठा लेंगे, {inco} शर्तों पर।",
        "mr": "तुमच्या पुष्टीनंतर {bd} दिवसांत आम्ही माल उचलू, {inco} अटींवर."},
    ("payment", "buy"): {
        "en": "The payment term in my {q} is {pay}.",
        "hi": "मेरे {q} में भुगतान की शर्त {pay} है।",
        "mr": "माझ्या {q} मधील पेमेंटची अट {pay} आहे."},
    ("payment", "sell"): {
        "en": "The payment term in my {q} is {pay}.",
        "hi": "मेरी {q} में भुगतान की शर्त {pay} है।",
        "mr": "माझ्या {q} मधील पेमेंटची अट {pay} आहे."},
    ("quantity", "buy"): {
        "en": "I have quoted for the full {qty} {unit}.",
        "hi": "मैंने पूरे {qty} {unit} के लिए कोटेशन दिया है।",
        "mr": "मी पूर्ण {qty} {unit} साठी कोटेशन दिले आहे."},
    ("quantity", "sell"): {
        "en": "My bid is for the full {qty} {unit}.",
        "hi": "मेरी बोली पूरे {qty} {unit} के लिए है।",
        "mr": "माझी बोली पूर्ण {qty} {unit} साठी आहे."},
    ("warranty", "buy"): {
        "en": "The supply carries a warranty of {warr} months.",
        "hi": "इस आपूर्ति पर {warr} महीने की वारंटी है।",
        "mr": "या पुरवठ्यावर {warr} महिन्यांची वॉरंटी आहे."},
    ("warranty", "sell"): {
        "en": "This is scrap material, so warranty does not really apply to my bid.",
        "hi": "यह स्क्रैप माल है, इसलिए मेरी बोली पर वारंटी लागू नहीं होती।",
        "mr": "हा स्क्रॅप माल आहे, त्यामुळे माझ्या बोलीवर वॉरंटी लागू होत नाही."},
    ("validity", "buy"): {
        "en": "My rate is valid for {valid} days.",
        "hi": "मेरी दर {valid} दिन तक मान्य है।",
        "mr": "माझा दर {valid} दिवस वैध आहे."},
    ("validity", "sell"): {
        "en": "My bid is valid for {valid} days.",
        "hi": "मेरी बोली {valid} दिन तक मान्य है।",
        "mr": "माझी बोली {valid} दिवस वैध आहे."},
    ("incoterm", "buy"): {
        "en": "The price is on {inco} basis.",
        "hi": "यह कीमत {inco} आधार पर है।",
        "mr": "ही किंमत {inco} आधारावर आहे."},
    ("incoterm", "sell"): {
        "en": "The bid is on {inco} basis.",
        "hi": "यह बोली {inco} आधार पर है।",
        "mr": "ही बोली {inco} आधारावर आहे."},
}
_NO_WARRANTY = {
    "en": "There is no separate warranty period on this, but we stand by the quality.",
    "hi": "इस पर अलग से वारंटी अवधि नहीं है, लेकिन गुणवत्ता की हमारी ज़िम्मेदारी है।",
    "mr": "यावर वेगळा वॉरंटी कालावधी नाही, पण गुणवत्तेची जबाबदारी आमची आहे."}
_VENDOR_GENERIC = {
    "en": "Let me check on that and get back to you.",
    "hi": "मैं इसे देखकर आपको बताता हूँ।",
    "mr": "मी ते तपासून तुम्हाला कळवतो."}

# How we answer a question the vendor asked about our requirement.
_OURS: dict[tuple[str, str], dict[str, str]] = {
    ("quantity", "buy"): {
        "en": "The requirement is {qty} {unit}, in a single order.",
        "hi": "हमारी आवश्यकता {qty} {unit} की है, एक ही ऑर्डर में।",
        "mr": "आमची गरज {qty} {unit} ची आहे, एकाच ऑर्डरमध्ये."},
    ("quantity", "sell"): {
        "en": "The lot is {qty} {unit}, to be lifted in one go.",
        "hi": "लॉट {qty} {unit} का है, जिसे एक ही बार में उठाना है।",
        "mr": "लॉट {qty} {unit} चा आहे, तो एकाच वेळी उचलायचा आहे."},
    ("delivery", "buy"): {
        "en": "We need the delivery within {id} days of the order.",
        "hi": "हमें ऑर्डर के बाद {id} दिन के भीतर डिलीवरी चाहिए।",
        "mr": "आम्हाला ऑर्डर नंतर {id} दिवसांत डिलिव्हरी हवी आहे."},
    ("delivery", "sell"): {
        "en": "The material will be ready for pickup within {id} days of the payment.",
        "hi": "भुगतान के {id} दिन के भीतर माल उठाने के लिए तैयार रहेगा।",
        "mr": "पेमेंट नंतर {id} दिवसांत माल उचलण्यासाठी तयार असेल."},
    ("payment", "buy"): {
        "en": "On payment we normally work with {pay} from the invoice.",
        "hi": "भुगतान के लिए हम आम तौर पर इनवॉइस से {pay} की शर्त रखते हैं।",
        "mr": "पेमेंटसाठी आम्ही साधारणपणे इनव्हॉइसपासून {pay} अट ठेवतो."},
    ("payment", "sell"): {
        "en": "On payment, {pay} works for us.",
        "hi": "भुगतान के लिए {pay} हमारे लिए ठीक है।",
        "mr": "पेमेंटसाठी {pay} आम्हाला चालेल."},
    ("incoterm", "buy"): {
        "en": "We would like it on {inco} basis.",
        "hi": "हमें यह {inco} आधार पर चाहिए।",
        "mr": "आम्हाला हे {inco} आधारावर हवे आहे."},
    ("incoterm", "sell"): {
        "en": "The material is offered on {inco} basis.",
        "hi": "माल {inco} आधार पर दिया जाएगा।",
        "mr": "माल {inco} आधारावर दिला जाईल."},
}
_OURS_GENERIC = {
    "en": "I will confirm that separately.",
    "hi": "मैं इसकी पुष्टि अलग से करता हूँ।",
    "mr": "मी याची वेगळी पुष्टी करतो."}

# A question we add to our own message, and one the vendor adds to its reply.
_ASK_OURS: dict[tuple[str, str], dict[str, str]] = {
    ("delivery", "buy"): {
        "en": "Also, what delivery time can you commit to?",
        "hi": "साथ ही, आप कितने समय में डिलीवरी दे सकेंगे?",
        "mr": "तसेच, तुम्ही किती वेळात डिलिव्हरी देऊ शकाल?"},
    ("delivery", "sell"): {
        "en": "Also, how soon can you lift the material?",
        "hi": "साथ ही, आप कितनी जल्दी माल उठा सकेंगे?",
        "mr": "तसेच, तुम्ही किती लवकर माल उचलू शकाल?"},
    ("warranty", "buy"): {
        "en": "And does the rate include any warranty?",
        "hi": "और क्या इस दर में कोई वारंटी शामिल है?",
        "mr": "आणि या दरामध्ये काही वॉरंटी समाविष्ट आहे का?"},
    ("validity", "sell"): {
        "en": "And how long is your bid valid?",
        "hi": "और आपकी बोली कितने दिन मान्य है?",
        "mr": "आणि तुमची बोली किती दिवस वैध आहे?"},
}
_ASK_VENDOR: dict[str, dict[str, str]] = {
    "buy": {
        "en": "By the way, can you confirm the exact quantity and the delivery time you need?",
        "hi": "वैसे, क्या आप सही मात्रा और ज़रूरी डिलीवरी समय बता सकते हैं?",
        "mr": "तसे, तुम्ही नेमके प्रमाण आणि हवा असलेला डिलिव्हरी वेळ सांगू शकाल का?"},
    "sell": {
        "en": "By the way, can you confirm the exact quantity and when I can lift the material?",
        "hi": "वैसे, क्या आप सही मात्रा और माल कब उठा सकता हूँ, यह बता सकते हैं?",
        "mr": "तसे, तुम्ही नेमके प्रमाण आणि मी माल कधी उचलू शकतो ते सांगू शकाल का?"},
}
VENDOR_QUESTION_TOPICS = "quantity,delivery"
# When we put a question to the vendor: see ours_question_topic.


def ours_question_topic(direction: str, round_no: int) -> Optional[str]:
    if round_no == 2:
        return "delivery"
    if round_no == 4:
        return "warranty" if direction == "buy" else "validity"
    return None


def ask_ours(topic: str, f: Facts) -> str:
    return _ASK_OURS[(topic, f.direction)][f.lang]


def ask_vendor(f: Facts) -> str:
    return _ASK_VENDOR[f.direction][f.lang]


def _fmt(template: str, f: Facts) -> str:
    return template.format(
        bd=f.bid_delivery_days, id=f.item_delivery_days, inco=f.incoterm, qty=_qty(f.qty), unit=f.unit_word,
        pay=_pay(f.lang, f.payment_code), valid=f.validity_days, warr=f.warranty_months,
        q=_QUOTE[f.direction][f.lang])


def vendor_answer(topic: str, f: Facts) -> str:
    t = _VENDOR.get((topic, f.direction))
    if topic == "warranty" and f.direction == "buy" and f.warranty_months <= 0:
        return _NO_WARRANTY[f.lang]
    if t is None:
        return _VENDOR_GENERIC[f.lang]
    return _fmt(t[f.lang], f)


def our_answer(topic: str, f: Facts) -> str:
    t = _OURS.get((topic, f.direction))
    return _fmt(t[f.lang], f) if t else _OURS_GENERIC[f.lang]


def vendor_answers(question_text: str, f: Facts, *, include_payment: bool = True) -> str:
    """The vendor's reply to a typed question; a generic holding line when nothing is recognised."""
    found = topics_in(question_text, include_payment=include_payment)
    if not found:
        return _VENDOR_GENERIC[f.lang]
    return " ".join(vendor_answer(t, f) for t in found)

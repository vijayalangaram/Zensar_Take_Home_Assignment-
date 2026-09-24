from typing import Optional

from pydantic import BaseModel, field_validator


class ResearchRequest(BaseModel):
    company_name: str

    @field_validator("company_name")
    @classmethod
    def not_blank(cls, value: str) -> str:
        return value.strip()


class KeyPerson(BaseModel):
    name: str
    title: str


class Financials(BaseModel):
    revenue: Optional[str] = None
    employee_count: Optional[str] = None
    market_cap: Optional[str] = None
    yoy_growth: Optional[str] = None


class ReportSummary(BaseModel):
    id: int
    company_name: str
    created_at: str


class ReportDetail(ReportSummary):
    overview: str
    key_people: list[KeyPerson]
    news: list[str]
    financials: Financials
    risks: list[str]

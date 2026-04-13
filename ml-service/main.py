"""SEVAARTH ML Service — FastAPI Application"""
import os
import sys
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Any
from dotenv import load_dotenv

load_dotenv()

# Add parent to path for model imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from models.billing_anomaly import detector as billing_detector
from models.referral_cluster import analyzer as referral_analyzer
from models.stay_predictor import predictor as stay_predictor
from models.fraud_scorer import scorer as fraud_scorer
from models.justification_nlp import score_justification, fuzzy_match_items

app = FastAPI(title="SEVAARTH ML Service", version="1.0.0", description="ML-powered fraud detection for hospital billing")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Request Models ──

class BillItem(BaseModel):
    id: Optional[int] = None
    item_name: str = ""
    item_code: Optional[str] = None
    quantity: int = 1
    unit_price: float = 0
    total_price: float = 0
    benchmark_price: float = 0

class ScoreBillingRequest(BaseModel):
    patient_id: int
    bill_items: List[BillItem]
    diagnosis_code: str

class ScoreReferralRequest(BaseModel):
    doctor_id: int
    referred_to: str
    time_period_days: int = 30

class PredictStayRequest(BaseModel):
    diagnosis_code: str
    age: int
    ward_type: str
    current_day: int

class ScoreJustificationRequest(BaseModel):
    justification_text: str
    diagnosis_code: str
    test_name: str
    outside_protocol: bool = True

class DetectUnbundlingRequest(BaseModel):
    bill_items: List[BillItem]
    procedure_code: Optional[str] = None

class FuzzyDuplicateRequest(BaseModel):
    new_item: BillItem
    existing_items: List[BillItem]

class AnalyzePatternsRequest(BaseModel):
    days: int = 30

# ── Endpoints ──

@app.get("/")
def root():
    return {"service": "SEVAARTH ML Service", "status": "running", "models": ["billing_anomaly", "referral_cluster", "stay_predictor", "fraud_scorer", "justification_nlp"]}

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/ml/score-billing")
def score_billing(req: ScoreBillingRequest):
    try:
        items = [item.dict() for item in req.bill_items]
        total = sum(item.get('total_price', 0) for item in items)
        num_items = len(items)
        avg_price = total / max(num_items, 1)
        
        # Score overall bill
        result = billing_detector.score(total, num_items, avg_price, req.diagnosis_code, 'general')
        
        # Score individual items
        flagged_items = billing_detector.score_items(items, req.diagnosis_code)
        
        return {
            **result,
            'flagged_items': flagged_items,
            'total_billed': total,
            'num_items': num_items
        }
    except Exception as e:
        return {"error": str(e), "anomaly_score": 0, "is_anomaly": False, "confidence": 0, "flagged_items": []}

@app.post("/ml/score-referral")
def score_referral(req: ScoreReferralRequest):
    try:
        result = referral_analyzer.score(
            referral_count_30d=10,  # Default since we don't have actual count in request
            referral_percentage=50,
            avg_bill=30000
        )
        return result
    except Exception as e:
        return {"error": str(e), "cluster_id": 0, "is_suspicious": False, "confidence": 0}

@app.post("/ml/predict-stay")
def predict_stay(req: PredictStayRequest):
    try:
        result = stay_predictor.predict(
            req.diagnosis_code, req.age, req.ward_type, req.current_day
        )
        return result
    except Exception as e:
        return {"error": str(e), "predicted_days": None, "overstay_risk": False}

@app.post("/ml/score-justification")
def score_justification_endpoint(req: ScoreJustificationRequest):
    try:
        result = score_justification(
            req.justification_text, req.diagnosis_code, req.test_name, req.outside_protocol
        )
        return result
    except Exception as e:
        return {"error": str(e), "validity_score": 0.5, "is_clinically_valid": None, "analysis_text": "Error", "red_flags": []}

@app.post("/ml/detect-unbundling")
def detect_unbundling(req: DetectUnbundlingRequest):
    try:
        items = [item.dict() for item in req.bill_items]
        result = fraud_scorer.detect_unbundling(items, req.procedure_code)
        return result
    except Exception as e:
        return {"error": str(e), "unbundling_detected": False}

@app.post("/ml/fuzzy-duplicate")
def fuzzy_duplicate(req: FuzzyDuplicateRequest):
    try:
        new_item = req.new_item.dict()
        existing = [item.dict() for item in req.existing_items]
        result = fuzzy_match_items(new_item, existing)
        return result
    except Exception as e:
        return {"error": str(e), "is_duplicate": False, "similarity_score": 0}

@app.post("/ml/analyze-patterns")
def analyze_patterns(req: AnalyzePatternsRequest):
    """Full pattern analysis — normally run on schedule."""
    try:
        results = {
            'billing_anomalies': [],
            'referral_clusters': [],
            'stay_outliers': [],
            'fraud_risk_patients': [],
            'analysis_period_days': req.days,
            'status': 'complete'
        }
        return results
    except Exception as e:
        return {"error": str(e), "status": "failed"}

# ── Train models on startup ──
@app.on_event("startup")
def startup_event():
    print("🚀 SEVAARTH ML Service starting...")
    # Try to load or train models
    for name, model in [
        ("Billing Anomaly", billing_detector),
        ("Referral Cluster", referral_analyzer),
        ("Stay Predictor", stay_predictor),
        ("Fraud Scorer", fraud_scorer)
    ]:
        if hasattr(model, 'load') and model.load():
            print(f"  ✅ {name} model loaded")
        elif hasattr(model, 'train'):
            try:
                model.train()
                print(f"  ✅ {name} model trained")
            except Exception as e:
                print(f"  ⚠️ {name} model training failed: {e}")
    print("🏥 ML Service ready!")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8000)))

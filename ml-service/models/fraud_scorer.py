"""Composite Fraud Scorer using Random Forest."""
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
import os
import pickle

MODEL_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.dirname(MODEL_DIR), 'data')

class FraudScorer:
    def __init__(self):
        self.model = RandomForestClassifier(
            n_estimators=100,
            max_depth=10,
            random_state=42
        )
        self.is_fitted = False
    
    def train(self):
        data_path = os.path.join(DATA_DIR, 'fraud_composite_train.csv')
        if not os.path.exists(data_path):
            print("⚠️ Training data not found.")
            return False
        
        df = pd.read_csv(data_path)
        features = ['anomaly_score', 'referral_flag', 'stay_overage_days',
                    'out_of_protocol_tests_pct', 'overcharge_pct',
                    'justification_score', 'duplicate_count']
        
        X = df[features].values
        y = df['is_fraud'].values
        
        self.model.fit(X, y)
        self.is_fitted = True
        
        model_path = os.path.join(MODEL_DIR, 'fraud_scorer.pkl')
        with open(model_path, 'wb') as f:
            pickle.dump(self.model, f)
        
        score = self.model.score(X, y)
        print(f"✅ Fraud scorer trained (accuracy = {score:.3f})")
        return True
    
    def load(self):
        model_path = os.path.join(MODEL_DIR, 'fraud_scorer.pkl')
        if os.path.exists(model_path):
            with open(model_path, 'rb') as f:
                self.model = pickle.load(f)
                self.is_fitted = True
            return True
        return False
    
    def score(self, anomaly_score=0, referral_flag=0, stay_overage_days=0,
              out_of_protocol_tests_pct=0, overcharge_pct=0,
              justification_score=0.8, duplicate_count=0):
        if not self.is_fitted:
            if not self.load():
                self.train()
        
        X = np.array([[anomaly_score, referral_flag, stay_overage_days,
                       out_of_protocol_tests_pct, overcharge_pct,
                       justification_score, duplicate_count]])
        
        probability = self.model.predict_proba(X)[0]
        fraud_prob = float(probability[1]) if len(probability) > 1 else 0.0
        
        # Feature importance for explanation
        importances = self.model.feature_importances_
        feature_names = ['anomaly_score', 'referral_flag', 'stay_overage_days',
                        'out_of_protocol_tests_pct', 'overcharge_pct',
                        'justification_score', 'duplicate_count']
        
        top_factors = sorted(zip(feature_names, importances), key=lambda x: -x[1])[:3]
        
        return {
            'fraud_probability': round(fraud_prob, 3),
            'is_fraud': fraud_prob > 0.5,
            'risk_level': 'critical' if fraud_prob > 0.8 else 'high' if fraud_prob > 0.6 else 'medium' if fraud_prob > 0.4 else 'low',
            'top_risk_factors': [{'factor': f[0], 'importance': round(float(f[1]), 3)} for f in top_factors]
        }

    def detect_unbundling(self, bill_items, procedure_code=None):
        """Detect bill unbundling using item pattern analysis."""
        if not bill_items:
            return {'unbundling_detected': False}
        
        total_billed = sum(item.get('total_price', 0) for item in bill_items)
        num_items = len(bill_items)
        
        # Check if items match common package patterns
        package_indicators = ['surgery', 'anesthesia', 'ot charges', 'surgeon fee',
                            'post-op', 'dressings', 'room', 'nursing']
        
        matching_items = [item for item in bill_items 
                         if any(ind in item.get('item_name', '').lower() for ind in package_indicators)]
        
        if len(matching_items) >= 3:
            # Likely a procedure that should be packaged
            package_est = total_billed * 0.65  # Estimate package price at 65% of unbundled
            variance_pct = ((total_billed - package_est) / package_est * 100) if package_est > 0 else 0
            
            return {
                'unbundling_detected': variance_pct > 15,
                'package_price': round(package_est),
                'billed_total': round(total_billed),
                'variance_pct': round(variance_pct, 1),
                'confidence': min(0.9, len(matching_items) / len(bill_items)),
                'matching_components': [i.get('item_name') for i in matching_items]
            }
        
        return {
            'unbundling_detected': False,
            'package_price': None,
            'billed_total': round(total_billed),
            'variance_pct': 0,
            'confidence': 0
        }


scorer = FraudScorer()

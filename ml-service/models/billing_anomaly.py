"""Billing Anomaly Detection using Isolation Forest."""
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import LabelEncoder
import os
import pickle

MODEL_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.dirname(MODEL_DIR), 'data')

class BillingAnomalyDetector:
    def __init__(self):
        self.model = IsolationForest(
            contamination=0.1,
            n_estimators=200,
            max_samples='auto',
            random_state=42
        )
        self.diagnosis_encoder = LabelEncoder()
        self.ward_encoder = LabelEncoder()
        self.is_fitted = False
    
    def train(self):
        """Train on synthetic billing data."""
        data_path = os.path.join(DATA_DIR, 'billing_train.csv')
        if not os.path.exists(data_path):
            print("⚠️ Training data not found. Run synthetic_train.py first.")
            return False
        
        df = pd.read_csv(data_path)
        
        # Encode categorical features
        df['diagnosis_encoded'] = self.diagnosis_encoder.fit_transform(df['diagnosis_code'])
        df['ward_encoded'] = self.ward_encoder.fit_transform(df['ward_type'])
        
        features = ['bill_total', 'num_items', 'avg_item_price', 'diagnosis_encoded', 'ward_encoded']
        X = df[features].values
        
        self.model.fit(X)
        self.is_fitted = True
        
        # Save model
        model_path = os.path.join(MODEL_DIR, 'billing_anomaly.pkl')
        with open(model_path, 'wb') as f:
            pickle.dump({
                'model': self.model,
                'diagnosis_encoder': self.diagnosis_encoder,
                'ward_encoder': self.ward_encoder
            }, f)
        
        print(f"✅ Billing anomaly model trained on {len(df)} records")
        return True
    
    def load(self):
        """Load trained model."""
        model_path = os.path.join(MODEL_DIR, 'billing_anomaly.pkl')
        if os.path.exists(model_path):
            with open(model_path, 'rb') as f:
                data = pickle.load(f)
                self.model = data['model']
                self.diagnosis_encoder = data['diagnosis_encoder']
                self.ward_encoder = data['ward_encoder']
                self.is_fitted = True
            return True
        return False
    
    def score(self, bill_total, num_items, avg_item_price, diagnosis_code, ward_type):
        """Score a billing record for anomalies."""
        if not self.is_fitted:
            if not self.load():
                self.train()
        
        try:
            diag_encoded = self.diagnosis_encoder.transform([diagnosis_code])[0]
        except ValueError:
            diag_encoded = 0
        
        try:
            ward_encoded = self.ward_encoder.transform([ward_type])[0]
        except ValueError:
            ward_encoded = 0
        
        X = np.array([[bill_total, num_items, avg_item_price, diag_encoded, ward_encoded]])
        
        anomaly_score = self.model.decision_function(X)[0]
        prediction = self.model.predict(X)[0]
        
        # Convert to 0-1 confidence score
        confidence = max(0, min(1, (0.5 - anomaly_score) / 0.5))
        
        return {
            'anomaly_score': float(anomaly_score),
            'is_anomaly': prediction == -1,
            'confidence': float(confidence)
        }
    
    def score_items(self, bill_items, diagnosis_code):
        """Score individual bill items for anomalies."""
        flagged_items = []
        for item in bill_items:
            if item.get('benchmark_price', 0) > 0:
                variance = (item['total_price'] - item['benchmark_price']) / item['benchmark_price']
                if variance > 0.15:
                    flagged_items.append({
                        'item_name': item['item_name'],
                        'charged': item['total_price'],
                        'benchmark': item['benchmark_price'],
                        'variance_pct': round(variance * 100, 1),
                        'severity': 'high' if variance > 0.5 else 'medium'
                    })
        return flagged_items


# Singleton instance
detector = BillingAnomalyDetector()

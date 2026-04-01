"""Stay Duration Predictor using Linear Regression."""
import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression
from sklearn.preprocessing import LabelEncoder
import os
import pickle

MODEL_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.dirname(MODEL_DIR), 'data')

class StayPredictor:
    def __init__(self):
        self.model = LinearRegression()
        self.diagnosis_encoder = LabelEncoder()
        self.ward_encoder = LabelEncoder()
        self.is_fitted = False
    
    def train(self):
        data_path = os.path.join(DATA_DIR, 'stay_train.csv')
        if not os.path.exists(data_path):
            print("⚠️ Training data not found.")
            return False
        
        df = pd.read_csv(data_path)
        df['diagnosis_encoded'] = self.diagnosis_encoder.fit_transform(df['diagnosis_code'])
        df['ward_encoded'] = self.ward_encoder.fit_transform(df['ward_type'])
        
        features = ['diagnosis_encoded', 'age', 'ward_encoded', 'comorbidities_count', 'is_insurance']
        X = df[features].values
        y = df['actual_stay_days'].values
        
        self.model.fit(X, y)
        self.is_fitted = True
        
        model_path = os.path.join(MODEL_DIR, 'stay_predictor.pkl')
        with open(model_path, 'wb') as f:
            pickle.dump({
                'model': self.model,
                'diagnosis_encoder': self.diagnosis_encoder,
                'ward_encoder': self.ward_encoder
            }, f)
        
        score = self.model.score(X, y)
        print(f"✅ Stay predictor trained (R² = {score:.3f})")
        return True
    
    def load(self):
        model_path = os.path.join(MODEL_DIR, 'stay_predictor.pkl')
        if os.path.exists(model_path):
            with open(model_path, 'rb') as f:
                data = pickle.load(f)
                self.model = data['model']
                self.diagnosis_encoder = data['diagnosis_encoder']
                self.ward_encoder = data['ward_encoder']
                self.is_fitted = True
            return True
        return False
    
    def predict(self, diagnosis_code, age, ward_type, current_day, comorbidities=0, is_insurance=0):
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
        
        X = np.array([[diag_encoded, age, ward_encoded, comorbidities, is_insurance]])
        predicted_days = max(1, round(self.model.predict(X)[0]))
        
        overstay_risk = current_day > predicted_days
        if predicted_days > 0:
            overstay_probability = min(1.0, max(0.0, (current_day - predicted_days) / predicted_days))
        else:
            overstay_probability = 0.0
        
        if overstay_risk:
            action = 'Review stay justification and consider discharge readiness assessment'
        elif current_day >= predicted_days - 1:
            action = 'Patient approaching predicted discharge — prepare for transition'
        else:
            action = 'Stay within normal range — continue monitoring'
        
        return {
            'predicted_days': int(predicted_days),
            'current_day': current_day,
            'overstay_risk': overstay_risk,
            'overstay_probability': round(float(overstay_probability), 3),
            'recommended_action': action
        }


predictor = StayPredictor()

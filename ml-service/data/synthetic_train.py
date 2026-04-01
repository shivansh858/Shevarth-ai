"""
Synthetic Training Data Generator for VHEAL ML Models.
Generates realistic hospital billing, referral, and stay data.
"""
import json
import random
import numpy as np
import pandas as pd
import os

random.seed(42)
np.random.seed(42)

DATA_DIR = os.path.dirname(os.path.abspath(__file__))

# Diagnosis codes and benchmarks
DIAGNOSES = [
    {'code': 'A01.0', 'name': 'Typhoid', 'stay': 7, 'cost': 45000},
    {'code': 'A90', 'name': 'Dengue', 'stay': 5, 'cost': 35000},
    {'code': 'B50.9', 'name': 'Malaria', 'stay': 5, 'cost': 30000},
    {'code': 'K35.80', 'name': 'Appendectomy', 'stay': 3, 'cost': 80000},
    {'code': 'O80', 'name': 'Normal Delivery', 'stay': 3, 'cost': 40000},
    {'code': 'O82', 'name': 'C-Section', 'stay': 5, 'cost': 90000},
    {'code': 'I21.9', 'name': 'Chest Pain/ACS', 'stay': 5, 'cost': 150000},
    {'code': 'E11.9', 'name': 'Diabetes', 'stay': 3, 'cost': 25000},
    {'code': 'I10', 'name': 'Hypertension', 'stay': 2, 'cost': 20000},
    {'code': 'J18.9', 'name': 'Pneumonia', 'stay': 5, 'cost': 50000},
]

WARD_TYPES = ['general', 'icu', 'private']


def generate_billing_data():
    """Generate 1200 billing records: 1000 normal + 200 fraudulent."""
    records = []
    
    # Normal billing records
    for i in range(1000):
        diag = random.choice(DIAGNOSES)
        ward = random.choice(WARD_TYPES)
        ward_mult = {'general': 1.0, 'icu': 2.5, 'private': 1.8}[ward]
        
        num_items = random.randint(5, 20)
        avg_price = diag['cost'] / num_items * (0.7 + random.random() * 0.6)
        bill_total = sum(avg_price * (0.5 + random.random()) for _ in range(num_items)) * ward_mult
        
        records.append({
            'patient_id': i + 1,
            'bill_total': round(bill_total, 2),
            'num_items': num_items,
            'avg_item_price': round(avg_price, 2),
            'diagnosis_code': diag['code'],
            'ward_type': ward,
            'benchmark_cost': diag['cost'] * ward_mult,
            'variance_pct': round((bill_total - diag['cost'] * ward_mult) / (diag['cost'] * ward_mult) * 100, 1),
            'is_fraud': 0
        })
    
    # Fraudulent billing records (200)
    for i in range(200):
        diag = random.choice(DIAGNOSES)
        ward = random.choice(WARD_TYPES)
        ward_mult = {'general': 1.0, 'icu': 2.5, 'private': 1.8}[ward]
        
        fraud_type = random.choice(['overcharge', 'unbundling', 'duplicate', 'inflated'])
        
        if fraud_type == 'overcharge':
            num_items = random.randint(5, 15)
            avg_price = diag['cost'] / num_items * (2.0 + random.random() * 3.0)
            bill_total = sum(avg_price * (0.8 + random.random() * 0.5) for _ in range(num_items)) * ward_mult
        elif fraud_type == 'unbundling':
            num_items = random.randint(15, 35)
            avg_price = diag['cost'] / 8 * (0.8 + random.random() * 0.4)
            bill_total = sum(avg_price * (0.9 + random.random() * 0.3) for _ in range(num_items)) * ward_mult
        elif fraud_type == 'duplicate':
            num_items = random.randint(10, 25)
            avg_price = diag['cost'] / num_items * (1.0 + random.random())
            bill_total = sum(avg_price for _ in range(num_items)) * ward_mult * 1.5
        else:
            num_items = random.randint(5, 12)
            avg_price = diag['cost'] / num_items * (3.0 + random.random() * 5.0)
            bill_total = sum(avg_price * (0.9 + random.random() * 0.3) for _ in range(num_items)) * ward_mult
        
        records.append({
            'patient_id': 1000 + i + 1,
            'bill_total': round(bill_total, 2),
            'num_items': num_items,
            'avg_item_price': round(avg_price, 2),
            'diagnosis_code': diag['code'],
            'ward_type': ward,
            'benchmark_cost': diag['cost'] * ward_mult,
            'variance_pct': round((bill_total - diag['cost'] * ward_mult) / (diag['cost'] * ward_mult) * 100, 1),
            'is_fraud': 1
        })
    
    df = pd.DataFrame(records)
    df.to_csv(os.path.join(DATA_DIR, 'billing_train.csv'), index=False)
    print(f"✅ Generated {len(records)} billing records ({sum(r['is_fraud'] for r in records)} fraudulent)")
    return df


def generate_stay_data():
    """Generate 500+ patient stay records."""
    records = []
    
    for i in range(600):
        diag = random.choice(DIAGNOSES)
        age = random.randint(18, 85)
        ward = random.choice(WARD_TYPES)
        comorbidities = random.randint(0, 5)
        is_insurance = random.choice([0, 1])
        
        # Actual stay with some variance
        base_stay = diag['stay']
        stay_modifier = 1.0
        if age > 65: stay_modifier += 0.3
        if comorbidities > 2: stay_modifier += 0.2 * comorbidities
        if ward == 'icu': stay_modifier += 0.5
        if is_insurance: stay_modifier += 0.15  # Insurance cases tend to stay slightly longer
        
        actual_stay = max(1, int(base_stay * stay_modifier * (0.7 + random.random() * 0.6)))
        
        # Add some extended stay fraud cases
        if random.random() < 0.1:
            actual_stay = int(actual_stay * (1.5 + random.random()))
        
        records.append({
            'patient_id': i + 1,
            'diagnosis_code': diag['code'],
            'age': age,
            'ward_type': ward,
            'comorbidities_count': comorbidities,
            'is_insurance': is_insurance,
            'standard_stay': base_stay,
            'actual_stay_days': actual_stay,
            'overstay': 1 if actual_stay > base_stay * 1.5 else 0
        })
    
    df = pd.DataFrame(records)
    df.to_csv(os.path.join(DATA_DIR, 'stay_train.csv'), index=False)
    print(f"✅ Generated {len(records)} stay records ({sum(r['overstay'] for r in records)} overstay)")
    return df


def generate_referral_data():
    """Generate 300 referral pattern records."""
    labs = ['Apollo Diagnostics', 'SRL Diagnostics', 'Metropolis', 'Dr. Lal PathLabs',
            'Thyrocare', 'Suburban Diagnostics', 'Max Lab', 'Fortis Lab']
    records = []
    
    for doctor_id in range(1, 31):
        total_refs = random.randint(5, 50)
        
        # Some doctors have kickback patterns
        is_kickback = random.random() < 0.15
        
        if is_kickback:
            primary_lab = random.choice(labs)
            primary_count = int(total_refs * (0.65 + random.random() * 0.25))
            remaining = total_refs - primary_count
            
            records.append({
                'doctor_id': doctor_id,
                'referred_to': primary_lab,
                'referral_count_30d': primary_count,
                'referral_percentage': round(primary_count / total_refs * 100, 1),
                'total_referrals': total_refs,
                'avg_bill_referred': round(random.uniform(15000, 80000), 2),
                'is_kickback': 1
            })
            
            other_labs = [l for l in labs if l != primary_lab]
            for lab in random.sample(other_labs, min(3, len(other_labs))):
                count = max(1, remaining // 3)
                remaining -= count
                records.append({
                    'doctor_id': doctor_id,
                    'referred_to': lab,
                    'referral_count_30d': count,
                    'referral_percentage': round(count / total_refs * 100, 1),
                    'total_referrals': total_refs,
                    'avg_bill_referred': round(random.uniform(10000, 50000), 2),
                    'is_kickback': 0
                })
        else:
            selected_labs = random.sample(labs, random.randint(3, 6))
            remaining = total_refs
            for idx, lab in enumerate(selected_labs):
                if idx == len(selected_labs) - 1:
                    count = remaining
                else:
                    count = max(1, int(remaining * random.uniform(0.1, 0.4)))
                    remaining -= count
                
                records.append({
                    'doctor_id': doctor_id,
                    'referred_to': lab,
                    'referral_count_30d': count,
                    'referral_percentage': round(count / total_refs * 100, 1),
                    'total_referrals': total_refs,
                    'avg_bill_referred': round(random.uniform(10000, 50000), 2),
                    'is_kickback': 0
                })
    
    df = pd.DataFrame(records)
    df.to_csv(os.path.join(DATA_DIR, 'referral_train.csv'), index=False)
    print(f"✅ Generated {len(records)} referral records ({sum(r['is_kickback'] for r in records)} kickback)")
    return df


def generate_fraud_composite_data():
    """Generate composite fraud scoring training data."""
    records = []
    
    for i in range(500):
        is_fraud = random.random() < 0.2
        
        if is_fraud:
            records.append({
                'anomaly_score': round(random.uniform(0.5, 1.0), 3),
                'referral_flag': random.choice([0, 1]),
                'stay_overage_days': random.randint(1, 10),
                'out_of_protocol_tests_pct': round(random.uniform(0.2, 0.8), 2),
                'overcharge_pct': round(random.uniform(15, 200), 1),
                'justification_score': round(random.uniform(0.0, 0.4), 2),
                'duplicate_count': random.randint(1, 5),
                'is_fraud': 1
            })
        else:
            records.append({
                'anomaly_score': round(random.uniform(-1.0, 0.3), 3),
                'referral_flag': 0 if random.random() < 0.9 else 1,
                'stay_overage_days': max(0, random.randint(-2, 1)),
                'out_of_protocol_tests_pct': round(random.uniform(0.0, 0.15), 2),
                'overcharge_pct': round(random.uniform(-5, 12), 1),
                'justification_score': round(random.uniform(0.6, 1.0), 2),
                'duplicate_count': 0,
                'is_fraud': 0
            })
    
    df = pd.DataFrame(records)
    df.to_csv(os.path.join(DATA_DIR, 'fraud_composite_train.csv'), index=False)
    print(f"✅ Generated {len(records)} composite fraud records ({sum(r['is_fraud'] for r in records)} fraud)")
    return df


if __name__ == '__main__':
    print("🏥 VHEAL Synthetic Training Data Generator\n")
    generate_billing_data()
    generate_stay_data()
    generate_referral_data()
    generate_fraud_composite_data()
    print("\n🎉 All training data generated!")

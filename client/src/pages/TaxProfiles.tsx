import React, { useEffect, useState } from "react";
import { Container } from "@/components/ui/Container";
import { Card } from "@/components/ui/Card";
import { Table } from "@/components/ui/Table";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { fetchTaxProfiles, createTaxProfile, createTaxRule, fetchEntities } from "@/adminApi";
import { Input } from "@/components/ui/Input";

interface Entity {
  _id: string;
  name: string;
  country: string;
}

interface TaxRule {
  _id: string;
  code: string;
  name: string;
  taxType: string;
  rate: number;
  applicationType: string;
}

interface TaxProfile {
  _id: string;
  name: string;
  entityId: Entity;
  taxRules: TaxRule[];
}

export function TaxProfiles() {
  const [profiles, setProfiles] = useState<TaxProfile[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isRuleModalOpen, setIsRuleModalOpen] = useState(false);
  
  const [profileForm, setProfileForm] = useState({ entityId: "", name: "" });
  const [ruleForm, setRuleForm] = useState({ profileId: "", entityId: "", country: "", taxType: "", code: "", name: "", rate: 0, applicationType: "INVOICE" });
  
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadData = async () => {
    try {
      const [profData, entData] = await Promise.all([fetchTaxProfiles(), fetchEntities()]);
      setProfiles(profData as TaxProfile[]);
      setEntities(entData as Entity[]);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await createTaxProfile(profileForm);
      setIsProfileModalOpen(false);
      loadData();
    } catch (e) {
      console.error(e);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRuleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      // Find entityId from profile
      const prof = profiles.find(p => p._id === ruleForm.profileId);
      const payload = {
        ...ruleForm,
        entityId: prof ? prof.entityId._id : ruleForm.entityId,
        rate: Number(ruleForm.rate)
      };
      await createTaxRule(payload);
      setIsRuleModalOpen(false);
      loadData();
    } catch (e) {
      console.error(e);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Container className="py-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Tax Profiles</h1>
        <div className="space-x-2">
          <Button variant="secondary" onClick={() => setIsProfileModalOpen(true)}>Create Profile</Button>
          <Button variant="primary" onClick={() => setIsRuleModalOpen(true)}>Add Tax Rule</Button>
        </div>
      </div>

      <div className="space-y-6">
        {profiles.map((p) => (
          <Card key={p._id} className="p-4">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="text-lg font-bold">{p.name}</h2>
                <span className="text-sm text-gray-500">Entity: {p.entityId?.name} ({p.entityId?.country})</span>
              </div>
            </div>
            {p.taxRules && p.taxRules.length > 0 ? (
              <Table>
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Rate (%)</th>
                    <th>Application</th>
                  </tr>
                </thead>
                <tbody>
                  {p.taxRules.map((r: TaxRule) => (
                    <tr key={r._id}>
                      <td className="font-medium">{r.code}</td>
                      <td>{r.name}</td>
                      <td>{r.taxType}</td>
                      <td>{r.rate}</td>
                      <td>{r.applicationType}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="text-sm text-gray-500">No active tax rules attached.</p>
            )}
          </Card>
        ))}
      </div>

      <Modal open={isProfileModalOpen} onClose={() => setIsProfileModalOpen(false)} title="Create Tax Profile">
        <form onSubmit={handleProfileSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Entity</label>
            <select
              className="w-full rounded-md border border-gray-300 p-2 text-sm"
              required
              value={profileForm.entityId}
              onChange={(e) => setProfileForm({ ...profileForm, entityId: e.target.value })}
            >
              <option value="">Select Entity</option>
              {entities.map(e => <option key={e._id} value={e._id}>{e.name} ({e.country})</option>)}
            </select>
          </div>
          <div className="grid gap-1">
            <span className="text-sm font-semibold text-slate-700">Profile Name <span className="text-red-500">*</span></span>
            <Input required value={profileForm.name} onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })} />
          </div>
          <div className="flex justify-end space-x-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsProfileModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Save Profile"}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={isRuleModalOpen} onClose={() => setIsRuleModalOpen(false)} title="Add Tax Rule">
        <form onSubmit={handleRuleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Assign to Profile</label>
            <select
              className="w-full rounded-md border border-gray-300 p-2 text-sm"
              required
              value={ruleForm.profileId}
              onChange={(e) => setRuleForm({ ...ruleForm, profileId: e.target.value })}
            >
              <option value="">Select Profile</option>
              {profiles.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
            </select>
          </div>
          <div className="grid gap-1">
            <span className="text-sm font-semibold text-slate-700">Country Code (e.g. IN) <span className="text-red-500">*</span></span>
            <Input required value={ruleForm.country} onChange={(e) => setRuleForm({ ...ruleForm, country: e.target.value.toUpperCase() })} />
          </div>
          <div className="grid gap-1">
            <span className="text-sm font-semibold text-slate-700">Tax Type (e.g. GST, VAT) <span className="text-red-500">*</span></span>
            <Input required value={ruleForm.taxType} onChange={(e) => setRuleForm({ ...ruleForm, taxType: e.target.value })} />
          </div>
          <div className="grid gap-1">
            <span className="text-sm font-semibold text-slate-700">Rule Code (e.g. CGST_9) <span className="text-red-500">*</span></span>
            <Input required value={ruleForm.code} onChange={(e) => setRuleForm({ ...ruleForm, code: e.target.value })} />
          </div>
          <div className="grid gap-1">
            <span className="text-sm font-semibold text-slate-700">Display Name (e.g. CGST) <span className="text-red-500">*</span></span>
            <Input required value={ruleForm.name} onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })} />
          </div>
          <div className="grid gap-1">
            <span className="text-sm font-semibold text-slate-700">Rate % <span className="text-red-500">*</span></span>
            <Input type="number" step="0.01" required value={ruleForm.rate} onChange={(e) => setRuleForm({ ...ruleForm, rate: parseFloat(e.target.value) })} />
          </div>
          
          <div className="flex justify-end space-x-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsRuleModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Save Rule"}</Button>
          </div>
        </form>
      </Modal>
    </Container>
  );
}

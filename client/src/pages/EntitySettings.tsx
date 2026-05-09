import React, { useEffect, useState } from "react";
import { Container } from "@/components/ui/Container";
import { Card } from "@/components/ui/Card";
import { Table } from "@/components/ui/Table";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { fetchEntities, createEntity } from "@/adminApi";
import { Input } from "@/components/ui/Input";

export function EntitySettings() {
  const [entities, setEntities] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ name: "", country: "", baseCurrency: "", timezone: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadData = async () => {
    try {
      const data = await fetchEntities() as any[];
      setEntities(data);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await createEntity(formData);
      setIsModalOpen(false);
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
        <h1 className="text-2xl font-bold">Entity Settings</h1>
        <Button variant="secondary" onClick={() => setIsModalOpen(true)}>Add Entity</Button>
      </div>

      <Card>
        <Table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Country</th>
              <th>Base Currency</th>
              <th>Timezone</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {entities.map((ent) => (
              <tr key={ent._id}>
                <td className="font-medium">{ent.name}</td>
                <td>{ent.country}</td>
                <td>{ent.baseCurrency}</td>
                <td>{ent.timezone || "N/A"}</td>
                <td>
                  <Badge variant={ent.isActive ? "success" : "neutral"}>
                    {ent.isActive ? "Active" : "Inactive"}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Modal open={isModalOpen} onClose={() => setIsModalOpen(false)} title="Add Entity">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-1">
            <span className="text-sm font-semibold text-slate-700">Entity Name <span className="text-red-500">*</span></span>
            <Input
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>
          <div className="grid gap-1">
            <span className="text-sm font-semibold text-slate-700">Country Code (e.g. IN, AE) <span className="text-red-500">*</span></span>
            <Input
              required
              value={formData.country}
              onChange={(e) => setFormData({ ...formData, country: e.target.value })}
            />
          </div>
          <div className="grid gap-1">
            <span className="text-sm font-semibold text-slate-700">Base Currency (e.g. INR, AED) <span className="text-red-500">*</span></span>
            <Input
              required
              value={formData.baseCurrency}
              onChange={(e) => setFormData({ ...formData, baseCurrency: e.target.value })}
            />
          </div>
          <div className="grid gap-1">
            <span className="text-sm font-semibold text-slate-700">Timezone (e.g. Asia/Kolkata) <span className="text-red-500">*</span></span>
            <Input
              required
              value={formData.timezone}
              onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
            />
          </div>
          <div className="flex justify-end space-x-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : "Save Entity"}
            </Button>
          </div>
        </form>
      </Modal>
    </Container>
  );
}
